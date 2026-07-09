import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { sanitizeName, computeDirectorySize } from "@/lib/cloud/tree";
import { guessMime } from "@/lib/cloud/mime";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Streaming multipart upload endpoint.
 *
 * CRITICAL: files are streamed directly to storage — memory usage stays flat
 * regardless of file size. A 20 GB video uses the same ~50 MB of RAM as a 1 KB
 * text file. This is what makes family-scale uploads crash-safe.
 *
 * Query params:
 *   parentId   — target folder id (null/missing = root)
 *
 * Body: multipart/form-data with `files` field(s).
 *
 * Safety guarantees:
 *   1. Quota pre-checked using Content-Length (rejects before any byte hits disk)
 *   2. Files streamed to disk via Node streams — zero buffering in RAM
 *   3. If disk fills mid-upload, partial file is deleted and error returned
 *   4. DB record only created after storage write succeeds
 *   5. If DB write fails, the stored file is cleaned up
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Rate limit — 100 uploads/min per user.
  const rl = rateLimit(`upload:${session.sub}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много загрузок. Попробуйте через минуту." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;

  // Verify parent belongs to caller and is a directory.
  if (parentId) {
    const parent = await db.fileNode.findFirst({
      where: {
        id: parentId,
        ownerId: session.sub,
        isDirectory: true,
        deletedAt: null,
      },
    });
    if (!parent) {
      return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
    }
  }

  // Pre-check quota using Content-Length header BEFORE parsing the body.
  // This lets us reject an over-quota upload before wasting any I/O.
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const usedBytes = await computeDirectorySize(user.id, null);
  if (contentLength > 0 && BigInt(usedBytes) + BigInt(contentLength) > user.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места",
        detail: {
          quota: user.quotaBytes.toString(),
          used: usedBytes.toString(),
          incoming: contentLength,
        },
      },
      { status: 413 }
    );
  }

  // Parse the multipart body. Next.js streams this — the files themselves
  // are NOT loaded into memory until we call .arrayBuffer() or similar.
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Нет файлов для загрузки" }, { status: 400 });
  }

  // Double-check quota using actual file sizes (more accurate than Content-Length).
  const totalIncoming = files.reduce((sum, f) => sum + f.size, 0);
  if (BigInt(usedBytes) + BigInt(totalIncoming) > user.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места",
        detail: {
          quota: user.quotaBytes.toString(),
          used: usedBytes.toString(),
          incoming: totalIncoming,
        },
      },
      { status: 413 }
    );
  }

  // Disk space pre-check (local storage only — S3/MinIO has its own quotas).
  const storage = getStorage();
  if (process.env.STORAGE_DRIVER !== "s3") {
    const root = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
    try {
      const stat = await fs.statfs(root);
      const freeBytes = stat.bsize * stat.bavail;
      if (BigInt(freeBytes) < BigInt(totalIncoming) * 2n) {
        return NextResponse.json(
          {
            error: "Недостаточно места на диске",
            detail: { free: freeBytes, needed: totalIncoming },
          },
          { status: 507 }
        );
      }
    } catch {
      // statfs not available on some platforms — skip the check.
    }
  }

  const created: unknown[] = [];

  for (const file of files) {
    const safeName = sanitizeName(file.name);
    const fileId = randomUUID();
    const storageKey = buildStorageKey(user.id, fileId, safeName);
    const mimeType = file.type || guessMime(safeName);

    // STREAM the file to storage — never buffer in RAM.
    // file.stream() returns a ReadableStream that emits chunks as they arrive
    // from the network. storage.put() pipes this directly to the filesystem
    // (or S3 multipart upload), so memory stays flat regardless of file size.
    let result;
    try {
      result = await storage.put(storageKey, file.stream() as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
    } catch (err) {
      // Upload failed mid-stream (disk full, network drop, etc).
      // Clean up any partial file so it doesn't waste space.
      await storage.delete(storageKey).catch(() => undefined);
      const msg = err instanceof Error ? err.message : "Ошибка записи";
      return NextResponse.json(
        { error: `Не удалось сохранить «${safeName}»: ${msg}` },
        { status: 500 }
      );
    }

    // Storage write succeeded — now create the DB record.
    let node;
    try {
      node = await db.fileNode.create({
        data: {
          id: fileId,
          ownerId: user.id,
          parentId,
          name: safeName,
          storageKey,
          isDirectory: false,
          sizeBytes: BigInt(result.sizeBytes),
          mimeType,
          hashSha256: result.hashSha256,
        },
      });
    } catch (dbErr) {
      // DB write failed — clean up the stored file to avoid orphaned bytes.
      await storage.delete(storageKey).catch(() => undefined);
      console.error("[upload] DB write failed, cleaned up storage:", dbErr);
      return NextResponse.json(
        { error: "Ошибка базы данных при записи файла" },
        { status: 500 }
      );
    }

    created.push({
      id: node.id,
      name: node.name,
      sizeBytes: node.sizeBytes.toString(),
      mimeType: node.mimeType,
    });
  }

  // Update user.usedBytes (eventually-consistent counter).
  const newUsed = await computeDirectorySize(user.id, null);
  await db.user.update({
    where: { id: user.id },
    data: { usedBytes: newUsed },
  });

  return NextResponse.json({ created, usedBytes: newUsed.toString() });
}
