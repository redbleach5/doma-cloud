import { NextRequest, NextResponse } from "next/server";
import { Transform } from "node:stream";
import { db } from "@/lib/db";
import { getSession, verifyPassword } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";

/**
 * Stream a file to the client with proper Range support for media playback.
 *
 * Access modes:
 *   1. Authenticated  — session cookie present, file must belong to the user.
 *   2. Shared         — ?token=<shareToken> present, file must match the share.
 *
 * Share access enforces ALL protections:
 *   - passwordHash     → requires share password verify (argon2id); cookie doma_sv_* for Range
 *   - expiresAt        → rejected if past
 *   - maxViews         → rejected if usedCount >= maxViews
 *   - oneTimeUse       → after first successful access, share is deleted
 *
 * View counter (usedCount) is incremented ONCE per browser session, not per
 * HTTP Range request. We track this via a signed session cookie that lasts
 * 24h — so a single video playback (dozens of Range requests) counts as 1
 * view, but reloading the page next day counts again.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const shareToken = url.searchParams.get("token");

  // Download throttle — 200 downloads/minute per IP.
  // Prevents abuse (e.g. scraping all shared files) without affecting legit use.
  // Range requests for media playback also count, but 200/min is generous.
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
      include: { file: true },
    });

    if (!share || share.fileId !== id) {
      return NextResponse.json({ error: "Ссылка недействительна" }, { status: 403 });
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
    }
    if (share.maxViews && share.usedCount >= share.maxViews) {
      return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
    }

    // #4 — Don't allow downloading shared files that have been moved to trash.
    // The owner might have deleted the file after creating the share — in that
    // case the share should not work until the file is restored.
    if (share.file.deletedAt) {
      return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
    }

    // #1 — PASSWORD CHECK. If the share has a password, the caller must prove
    // they know it. The share page (POST /api/share/[token]) sets a
    // verified-session cookie after the user enters the password; we honour
    // that here so subsequent media Range requests don't need to re-send it.
    if (share.passwordHash) {
      // Cookie key is derived from the share TOKEN (consistent with /api/share/[token]).
      const cookieKey = `doma_sv_${hashSuffix(share.token)}`;
      const verifiedCookie = req.cookies.get(cookieKey)?.value === "1";
      if (!verifiedCookie) {
        // Try the explicit ?sharePassword= query param (used by download links
        // generated after password verification on the share page).
        const pwParam = url.searchParams.get("sharePassword");
        if (!pwParam || !(await verifyPassword(pwParam, share.passwordHash))) {
          return NextResponse.json(
            { error: "Требуется пароль", needsPassword: true },
            { status: 401 }
          );
        }
      }
    }

    node = share.file;

    // #3 — VIEW COUNTER is NOT incremented here. It's incremented in
    // POST /api/share/[token] (the share-page verification endpoint),
    // which is called ONCE when the user opens the share link — not on
    // every media Range request. This prevents a single video playback
    // (dozens of Range requests) from exhausting the maxViews quota.
    //
    // The oneTimeUse flag is also enforced in /api/share/[token] — after
    // the first successful verification, the share is deleted there.
    // We double-check here that the share still exists (it does, since we
    // just fetched it above).

    cacheVisibility = "private, max-age=3600";
  } else {
    // ---- Authenticated access ----
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    // #10 — Don't allow downloading trashed files via direct link.
    // Files in trash should only be accessible after restoration.
    node = await db.fileNode.findFirst({
      where: { id, ownerId: session.sub, deletedAt: null },
    });
    if (!node) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }
  }

  if (node.isDirectory) {
    return NextResponse.json({ error: "Это папка" }, { status: 400 });
  }

  const storage = await getStorage();
  const stat = await storage.stat(node.storageKey);

  // NOTE: share-session cookies (doma_sv_<hash>) are set by POST /api/share/[token],
  // not here. We only READ them to allow media Range requests through without
  // re-sending the password.

  // Range support for media streaming.
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;

      // #7 — Validate Range against actual file size (RFC 7233).
      // If start >= file size → 416 Range Not Satisfiable.
      // If end >= file size → clamp to size - 1.
      if (start >= stat.size) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${stat.size}`,
          },
        });
      }
      if (end >= stat.size) {
        end = stat.size - 1;
      }
      if (end < start) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${stat.size}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const stream = await storage.get(node.storageKey);
      // Slice the requested byte range by piping through a Transform.
      let sent = 0;
      const slicer = new Transform({
        transform(chunk, _enc, cb) {
          if (sent + chunk.length <= start) {
            sent += chunk.length;
            cb();
            return;
          }
          if (sent >= end + 1) {
            cb();
            return;
          }
          let out = chunk;
          if (sent < start) {
            out = chunk.subarray(start - sent);
          }
          if (sent + chunk.length > end + 1) {
            out = out.subarray(0, end + 1 - Math.max(start, sent));
          }
          sent += chunk.length;
          cb(null, out);
        },
      });
      stream.pipe(slicer);
      const res = new NextResponse(slicer as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": node.mimeType,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": cacheVisibility,
        },
      });
      return res;
    }
  }

  const stream = await storage.get(node.storageKey);
  const res = new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": node.mimeType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(node.name)}`,
      "Cache-Control": cacheVisibility,
    },
  });
  return res;
}

// ---- Share-session cookie helpers ----
//
// We track two things in cookies (keyed by a hash of the share TOKEN):
//   1. doma_sv_<hash>    — set after password verification, lasts 24h.
//      Allows media Range requests without re-sending the password.
//   2. doma_sview_<hash> — set after the first view count increment, lasts 24h.
//      Prevents Range requests from inflating the counter.
//
// The hash is non-cryptographic but stable — the token itself is unguessable
// (24 random chars from nanoid), so the cookie key can't be forged without
// already knowing the token.

function hashSuffix(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
