import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import {
  shareVerifiedCookieKey,
  shareViewGrantError,
} from "@/lib/auth/share-cookie";
import { resolveNodeAccess } from "@/lib/cloud/tree";

/**
 * Stream a file to the client with proper Range support for media playback.
 *
 * Access modes:
 *   1. Authenticated  — session cookie present, file must belong to the user.
 *   2. Shared         — ?token=<shareToken> present, file must match the share.
 *
 * Share-access enforcement:
 *   - passwordHash  → checked via `doma_sv_<hash>` cookie set by POST /api/share/[token]
 *   - expiresAt     → re-checked here (defensive — share may have expired since verify)
 *   - maxViews / oneTimeUse → capped shares require `doma_svd_<hash>` from verify
 *     (the view slot is granted there via atomic usedCount increment). Unlimited
 *     shares (no cap) allow direct download with the token alone.
 *
 * Content-Type hardening (anti-XSS):
 *   The uploader controls the filename and the browser-controlled mime type.
 *   Without hardening, an attacker who can upload a file (any family member, or
 *   anyone with a share link) can serve `text/html` from the same origin as the
 *   app and steal the session cookie. We force `application/octet-stream` for
 *   dangerous types (HTML, SVG, XML, JS) and use `attachment` disposition.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const shareToken = url.searchParams.get("token");

  // Download throttle — 200 downloads/minute per IP.
  const ip = getClientIp(req);
  const rl = rateLimit(`download:${ip}`, LIMITS.download.limit, LIMITS.download.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let node;
  let cacheVisibility: string = "private";

  if (shareToken) {
    // ---- Shared access ----
    const share = await db.share.findUnique({
      where: { token: shareToken },
      include: { node: true },
    });

    if (!share || share.nodeId !== id) {
      return NextResponse.json({ error: "Ссылка недействительна" }, { status: 403 });
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
    }

    // Don't serve shares for trashed files.
    if (share.node.deletedAt) {
      return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
    }

    // Password check — `doma_sv_<hash>` cookie is set by POST /api/share/[token]
    // after the user enters the password. We do NOT accept `?sharePassword=` in
    // the URL anymore (it leaked into access logs / referrers / browser history
    // and was brute-forceable at the download rate limit of 200/min).
    if (share.passwordHash) {
      const cookieKey = shareVerifiedCookieKey(share.token);
      const verifiedCookie = req.cookies.get(cookieKey)?.value === "1";
      if (!verifiedCookie) {
        return NextResponse.json(
          { error: "Требуется пароль", needsPassword: true },
          { status: 401 }
        );
      }
    }

    const viewGrant = shareViewGrantError(req, share);
    if (viewGrant) {
      return NextResponse.json(viewGrant.body, { status: viewGrant.status });
    }

    node = share.node;
    // Shared-download responses MUST NOT be cached: revoking the share or
    // exceeding maxViews must take effect immediately, not after the
    // browser's cache TTL expires. Previously max-age=3600 let the browser
    // serve the file from cache for up to an hour AFTER the owner revoked
    // the share — for one-time-use shares that was especially bad.
    cacheVisibility = "no-store";
  } else {
    // ---- Authenticated access ----
    //
    // Two paths:
    //   1. Owner     — file belongs to the caller.
    //   2. Shared    — file is inside a folder shared with the caller
    //                  (view / upload / edit permission all grant read).
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const access = await resolveNodeAccess(session.sub, id);
    if (!access || access.node.isDirectory) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }
    if (access.node.deletedAt) {
      return NextResponse.json({ error: "Файл в корзине" }, { status: 404 });
    }
    node = access.node;
  }

  if (node.isDirectory) {
    return NextResponse.json({ error: "Это папка" }, { status: 400 });
  }

  const storage = await getStorage();
  const stat = await storage.stat(node.storageKey);

  // Range support for media streaming (RFC 7233).
  //
  // Supported forms:
  //   bytes=<start>-<end>   → explicit range (end optional, clamped to size-1)
  //   bytes=<start>-        → from <start> to end of file
  //   bytes=-<N>            → last N bytes (suffix-range)
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start: number;
      let end: number;

      if (m[1] === "" && m[2] === "") {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      } else if (m[1] === "") {
        // Suffix range: last N bytes.
        const n = parseInt(m[2], 10);
        if (!Number.isFinite(n) || n <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${stat.size}` },
          });
        }
        start = Math.max(0, stat.size - n);
        end = stat.size - 1;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      }

      // Validate against actual file size.
      if (!Number.isFinite(start) || start < 0 || start >= stat.size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      if (end >= stat.size) end = stat.size - 1;
      if (end < start) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }

      const chunkSize = end - start + 1;
      // True partial-content stream when the backend supports it — avoids
      // reading the entire file from disk just to serve a tail range.
      const rangeStream = await storage.getRange(node.storageKey, start, end);
      return new NextResponse(rangeStream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": safeContentType(node.mimeType),
          "Content-Disposition": safeContentDisposition(node.mimeType, node.name),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": cacheVisibility,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  const stream = await storage.get(node.storageKey);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": safeContentType(node.mimeType),
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": safeContentDisposition(node.mimeType, node.name),
      "Cache-Control": cacheVisibility,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---- Content-Type / Disposition hardening (anti-XSS) ----

const INLINE_SAFE_MIME_PREFIXES = ["image/", "video/", "audio/"] as const;
const INLINE_SAFE_MIME_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
]);
const DANGEROUS_MIME_EXACT = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/xml",
  "text/xml",
]);

function isInlineSafeMime(mime: string): boolean {
  const lower = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (DANGEROUS_MIME_EXACT.has(lower)) return false;
  if (INLINE_SAFE_MIME_EXACT.has(lower)) return true;
  for (const prefix of INLINE_SAFE_MIME_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

function safeContentType(mime: string): string {
  return isInlineSafeMime(mime) ? mime : "application/octet-stream";
}

function safeContentDisposition(mime: string, name: string): string {
  const fallback = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  if (!isInlineSafeMime(mime)) return fallback;
  return `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ---- Share cookie helpers ----
//
// The previous implementation used a 32-bit FNV-like hash for the cookie
// suffix, which collides after ~65 K shares (birthday paradox) and allowed
// a viewer who verified share A to bypass the password on share B if both
// tokens hashed to the same suffix. sha256 truncation eliminates that risk.
//
// The implementation lives in @/lib/auth/share-cookie so it can be shared
// across the share-verify, download, and thumbnail routes without coupling
// them via cross-route-handler imports.
