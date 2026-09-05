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
import {
  pruneThumbCache,
  thumbCacheKey,
  thumbEtag,
} from "@/lib/cloud/thumbnail-cache";

/**
 * Generate a small thumbnail for an image file.
 *
 * Query: ?size=<px>  (default 256, max 2048)
 *
 * Results are written to disk under `.thumbs/<nodeId>/<size>-<updatedAtMs>.jpg`
 * so a photo folder does not re-run sharp on every scroll. Authenticated
 * responses also honor `If-None-Match` → 304.
 *
 * Size 2048 is for full-screen preview of formats browsers cannot decode
 * natively (HEIC/HEIF, TIFF, SVG rasterized via sharp).
 */

const VALID_SIZES = new Set([64, 128, 256, 512, 1024, 2048]);

interface NodeForThumbnail {
  id: string;
  storageKey: string;
  mimeType: string;
  name: string;
  updatedAt: Date;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);

  const ip = getClientIp(req);
  // Authenticated thumbnails get their own generous, separately-keyed bucket
  // (bursts when a folder with hundreds of photos opens). Share-token
  // thumbnails stay on the `download` bucket — they are public and easily
  // spammable. Distinct keys (`thumb:` vs `download:`) so previews never
  // consume the download quota and vice versa.
  const isShareToken = url.searchParams.get("token") != null;
  const rl = rateLimit(
    isShareToken ? `download:${ip}` : `thumb:${ip}`,
    isShareToken ? LIMITS.download.limit : LIMITS.thumbnail.limit,
    isShareToken ? LIMITS.download.windowMs : LIMITS.thumbnail.windowMs
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 }
    );
  }

  const shareToken = url.searchParams.get("token");
  let node: NodeForThumbnail | null = null;

  if (shareToken) {
    const share = await db.share.findUnique({
      where: { token: shareToken },
      include: {
        node: {
          select: {
            id: true,
            ownerId: true,
            deletedAt: true,
            mimeType: true,
            storageKey: true,
            name: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!share || share.nodeId !== id) {
      return NextResponse.json({ error: "Ссылка недействительна" }, { status: 403 });
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
    }
    if (share.node.deletedAt) {
      return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
    }
    if (share.passwordHash) {
      const cookieKey = shareVerifiedCookieKey(share.token);
      if (req.cookies.get(cookieKey)?.value !== "1") {
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
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const access = await resolveNodeAccess(session.sub, id);
    if (!access || access.node.deletedAt) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }
    node = {
      id: access.node.id,
      storageKey: access.node.storageKey,
      mimeType: access.node.mimeType,
      name: access.node.name,
      updatedAt: access.node.updatedAt,
    };
  }

  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (!node.mimeType.startsWith("image/")) {
    return NextResponse.json({ error: "Не изображение" }, { status: 404 });
  }

  const sizeParam = parseInt(url.searchParams.get("size") ?? "256", 10);
  const size = VALID_SIZES.has(sizeParam) ? sizeParam : 256;
  const updatedAtMs = node.updatedAt.getTime();
  const etag = thumbEtag(node.id, size, updatedAtMs);

  // Share-token thumbs are still cacheable on disk server-side, but browsers
  // must not keep them after revoke (`no-store`).
  const cacheVisibility = shareToken ? "no-store" : "private, max-age=86400";

  if (!shareToken) {
    const inm = req.headers.get("if-none-match");
    if (inm && inm === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": cacheVisibility,
        },
      });
    }
  }

  const storage = await getStorage();
  const cacheKey = thumbCacheKey(node.id, size, updatedAtMs);

  try {
    const cached = await storage.getBuffer(cacheKey);
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(cached.byteLength),
        "Cache-Control": cacheVisibility,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "X-Thumb-Cache": "HIT",
      },
    });
  } catch {
    // miss — generate below
  }

  const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
  try {
    const stat = await storage.stat(node.storageKey);
    if (stat.size > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { error: "Файл слишком большой для генерации превью" },
        { status: 413 }
      );
    }
  } catch {
    // stream path will fail if missing
  }

  const sharp = (await import("sharp")).default;
  let jpeg: Buffer;
  try {
    const source = await storage.getBuffer(node.storageKey);
    jpeg = await sharp(source, { limitInputPixels: 100_000_000 })
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Не удалось создать превью" }, { status: 500 });
  }

  // Best-effort cache write — serve even if disk is full.
  try {
    await storage.put(cacheKey, jpeg);
    await pruneThumbCache(storage, node.id, cacheKey);
  } catch {
    // ignore
  }

  return new NextResponse(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": cacheVisibility,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "X-Thumb-Cache": "MISS",
    },
  });
}
