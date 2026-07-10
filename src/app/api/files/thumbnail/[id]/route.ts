import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";

/**
 * Generate a small thumbnail for an image file on the fly.
 *
 * Query: ?size=<px>  (default 256, max 1024)
 *
 * Why this exists: the file grid/list previously used `/api/files/download/[id]`
 * as the `<img src>` for thumbnails. For a folder with 200 photos at 8 MB each,
 * the browser would pull 1.6 GB through the network on first paint — even with
 * `loading="lazy"`, the first ~20 above the fold would load full-size. This
 * endpoint generates a JPEG thumbnail of the requested size on the server
 * using `sharp`, with `Cache-Control: private, max-age=86400` so subsequent
 * renders hit the browser cache.
 *
 * Authentication: same as download — session cookie OR share token. We don't
 * accept `?sharePassword=` here (it was removed from download too — see the
 * share-cookie flow in POST /api/share/[token]).
 */

const VALID_SIZES = new Set([64, 128, 256, 512, 1024]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);

  const ip = getClientIp(req);
  const rl = rateLimit(`download:${ip}`, LIMITS.download.limit, LIMITS.download.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 }
    );
  }

  const shareToken = url.searchParams.get("token");
  let ownerId: string | null = null;

  if (shareToken) {
    const share = await db.share.findUnique({
      where: { token: shareToken },
      include: { file: { select: { id: true, ownerId: true, deletedAt: true, mimeType: true } } },
    });
    if (!share || share.fileId !== id) {
      return NextResponse.json({ error: "Ссылка недействительна" }, { status: 403 });
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
    }
    if (share.file.deletedAt) {
      return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
    }
    if (share.passwordHash) {
      const cookieKey = `doma_sv_${(await import("node:crypto")).createHash("sha256").update(share.token).digest("hex").slice(0, 16)}`;
      if (req.cookies.get(cookieKey)?.value !== "1") {
        return NextResponse.json(
          { error: "Требуется пароль", needsPassword: true },
          { status: 401 }
        );
      }
    }
    ownerId = share.file.ownerId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    ownerId = session.sub;
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: ownerId ?? undefined, deletedAt: null },
    select: { id: true, storageKey: true, mimeType: true, name: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Only generate thumbnails for images.
  if (!node.mimeType.startsWith("image/")) {
    return NextResponse.json({ error: "Не изображение" }, { status: 404 });
  }

  // Parse size.
  const sizeParam = parseInt(url.searchParams.get("size") ?? "256", 10);
  const size = VALID_SIZES.has(sizeParam) ? sizeParam : 256;

  const storage = await getStorage();
  const stream = await storage.get(node.storageKey);

  // Lazy-load sharp (it's a native dep — only paid when actually needed).
  const sharp = (await import("sharp")).default;
  const transformer = sharp()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true });

  stream.pipe(transformer);

  return new NextResponse(transformer as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
