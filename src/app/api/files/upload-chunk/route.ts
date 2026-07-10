import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage, buildStorageKey, getCachedLocalStorageRoot, LocalFileStorage } from "@/lib/storage";
import { sanitizeName } from "@/lib/cloud/tree";
import { guessMime } from "@/lib/cloud/mime";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Chunked (resumable) upload endpoint — the backbone of crash-safe uploads.
 *
 * The client splits a large file into chunks of ~5 MB and POSTs each chunk
 * here with these headers / query params:
 *
 *   POST /api/files/upload-chunk?parentId=<id>
 *   Headers:
 *     X-Upload-Id      — stable session id (client-generated UUID)
 *     X-File-Name      — original filename
 *     X-File-Size      — total file size in bytes
 *     X-File-Mime      — mime type (optional)
 *     X-Chunk-Index    — 0-based chunk number
 *     X-Chunk-Total    — total chunk count
 *   Body: raw binary chunk bytes (NOT multipart)
 *
 * Each chunk is appended to a temporary file. When the last chunk arrives
 * (X-Chunk-Index === X-Chunk-Total - 1), the file is finalized:
 *   - hash computed over the whole file
 *   - FileNode record created in the DB
 *   - temp file renamed to its permanent storage key
 *
 * Memory stays flat: each request body is ≤ chunk size (5 MB), and we stream
 * it straight to disk via file.stream() → fs.createWriteStream.
 *
 * Crash recovery: if the client crashes mid-upload, the temp file lingers.
 * A cleanup job (or the user re-uploading with the same X-Upload-Id) will
 * resume from the last successfully written chunk.
 *
 * Storage backend support:
 *   - LocalFileStorage: chunks land in `<root>/.uploads/<user>/<uploadId>/`
 *     and are concatenated on the final chunk into the permanent storage key
 *     via streaming pipe through sha256.
 *   - S3FileStorage: chunks land in `<bucket>/.uploads/<user>/<uploadId>/`
 *     and the final file is assembled by sequentially streaming each chunk
 *     through `storage.put()`'s hashing pipe.
 */

const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64 MB hard cap per chunk

interface ChunkMeta {
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileMime: string;
  chunkIndex: number;
  chunkTotal: number;
}

function parseMeta(req: NextRequest): ChunkMeta | null {
  const uploadId = req.headers.get("x-upload-id");
  // #3 — Client sends encodeURIComponent(file.name) in X-File-Name.
  // We MUST decode it here, otherwise the file is saved with a URL-encoded
  // name on disk (e.g. %D0%BA%D0%B8%D1%80.txt instead of кириллица.txt).
  const rawFileName = req.headers.get("x-file-name");
  const fileName = rawFileName ? safeDecodeURIComponent(rawFileName) : null;
  const fileSize = parseInt(req.headers.get("x-file-size") ?? "0", 10);
  const fileMime = req.headers.get("x-file-mime") ?? "application/octet-stream";
  const chunkIndex = parseInt(req.headers.get("x-chunk-index") ?? "0", 10);
  const chunkTotal = parseInt(req.headers.get("x-chunk-total") ?? "0", 10);

  if (!uploadId || !fileName || !fileSize || !chunkTotal) return null;
  if (chunkIndex < 0 || chunkIndex >= chunkTotal) return null;
  if (fileSize > Number.MAX_SAFE_INTEGER) return null;

  return { uploadId, fileName, fileSize, fileMime, chunkIndex, chunkTotal };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Rate limit — 100 chunk uploads/min per user (same bucket as /upload).
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

  const meta = parseMeta(req);
  if (!meta) {
    return NextResponse.json({ error: "Неверные заголовки чанка" }, { status: 400 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_CHUNK_SIZE) {
    return NextResponse.json(
      { error: `Чанк слишком большой (макс ${MAX_CHUNK_SIZE / 1024 / 1024} МБ)` },
      { status: 413 }
    );
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;

  // #2 — CRITICAL: validate parentId on EVERY chunk, not just chunk 0.
  // The original code only checked on chunkIndex === 0, so an attacker could
  // send chunk 0 to root (no parentId) and then chunk 1+ with ?parentId=<target>
  // to hijack the file into a different folder.
  //
  // Solution: on chunk 0, verify the parent and persist it in a session file.
  // On subsequent chunks, IGNORE the ?parentId query param and use the
  // persisted value. This makes the upload session immutable.
  const sessionFile = path.join(
    uploadTempRoot(session.sub),
    meta.uploadId,
    "session.json"
  );

  let effectiveParentId: string | null = null;

  if (meta.chunkIndex === 0) {
    // First chunk — validate parentId and persist it.
    if (parentId) {
      const parent = await db.fileNode.findFirst({
        where: { id: parentId, ownerId: session.sub, isDirectory: true, deletedAt: null },
      });
      if (!parent) {
        return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
      }
      effectiveParentId = parentId;
    }
    // Persist the session metadata so subsequent chunks can't override it.
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(
      sessionFile,
      JSON.stringify({ parentId: effectiveParentId, fileName: meta.fileName, fileSize: meta.fileSize }),
      "utf-8"
    );
  } else {
    // Subsequent chunk — read the persisted parentId, IGNORE the query param.
    try {
      const sessionData = JSON.parse(await fs.readFile(sessionFile, "utf-8"));
      effectiveParentId = sessionData.parentId ?? null;
    } catch {
      return NextResponse.json(
        { error: "Upload session not found. Restart the upload." },
        { status: 410 }
      );
    }
  }

  // Quota check on the first chunk — use the cached `usedBytes` column
  // (O(1)) instead of a full tree traversal.
  if (meta.chunkIndex === 0) {
    const user = await db.user.findUnique({ where: { id: session.sub } });
    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (user.usedBytes + BigInt(meta.fileSize) > user.quotaBytes) {
      return NextResponse.json(
        { error: "Превышен лимит места", detail: { quota: user.quotaBytes.toString(), used: user.usedBytes.toString(), incoming: meta.fileSize } },
        { status: 413 }
      );
    }
  }

  // Write this chunk to its own temp storage key: .uploads/<user>/<uploadId>/chunk-<index>
  // We use the storage abstraction so both Local and S3 backends work.
  const storage = await getStorage();
  const chunkKey = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/chunk-${meta.chunkIndex}`;
  const chunkStream = req.body;

  if (chunkStream) {
    try {
      await storage.put(
        chunkKey,
        chunkStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка записи чанка";
      return NextResponse.json(
        { error: `Не удалось сохранить чанк: ${msg}` },
        { status: 500 }
      );
    }
  }

  // If this is NOT the last chunk, acknowledge and wait for more.
  if (meta.chunkIndex < meta.chunkTotal - 1) {
    return NextResponse.json({
      uploadId: meta.uploadId,
      chunkIndex: meta.chunkIndex,
      received: true,
      finalized: false,
    });
  }

  // LAST CHUNK — assemble the final file.
  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const safeName = sanitizeName(meta.fileName);
  const fileId = randomUUID();
  const storageKey = buildStorageKey(user.id, fileId, safeName);
  const mimeType = meta.fileMime || guessMime(safeName);

  // Concatenate all chunks into the final storage key — STREAMING through the
  // storage abstraction so S3 and local FS both work.
  //
  // We build a single composite Readable that sequentially emits each chunk's
  // bytes (pulled via storage.get()), and feed it to storage.put() which
  // hashes + counts bytes on the fly. Memory stays flat regardless of total
  // file size.
  const { createHash } = await import("node:crypto");
  const { Readable } = await import("node:stream");
  const hash = createHash("sha256");
  let totalSize = 0;

  const compositeStream = new Readable({
    async read() {
      // No-op; data is pushed from the async loop below.
    },
  });

  // Drive the composite stream: pull each chunk in order, push its bytes.
  (async () => {
    try {
      for (let i = 0; i < meta.chunkTotal; i++) {
        const ck = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/chunk-${i}`;
        const chunkReadable = await storage.get(ck);
        for await (const buf of chunkReadable) {
          const b = buf as Buffer;
          hash.update(b);
          totalSize += b.length;
          if (!compositeStream.push(b)) {
            // Backpressure: wait for drain.
            await new Promise<void>((resolve) => compositeStream.once("drain", resolve));
          }
        }
        // Delete the chunk to free space as we go.
        await storage.delete(ck).catch(() => undefined);
      }
      compositeStream.push(null); // end of stream
    } catch (err) {
      compositeStream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })().catch((err) => {
    compositeStream.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  // Stream the composite into the final storage key. storage.put() handles
  // hashing internally, but we recompute hash+size here because storage.put()
  // returns its own hash of what it received — and we want to verify the
  // declared size matches. We discard the put()'s hash and use ours.
  let putResult: { storageKey: string; sizeBytes: number; hashSha256?: string } | null = null;
  try {
    putResult = await storage.put(storageKey, compositeStream);
  } catch (err) {
    // Clean up any partial final object + remaining chunks.
    await storage.delete(storageKey).catch(() => undefined);
    for (let i = 0; i < meta.chunkTotal; i++) {
      const ck = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/chunk-${i}`;
      await storage.delete(ck).catch(() => undefined);
    }
    const msg = err instanceof Error ? err.message : "Ошибка сборки файла";
    return NextResponse.json(
      { error: `Не удалось собрать файл: ${msg}` },
      { status: 500 }
    );
  }

  // Clean up the temp directory marker (session.json) — for local FS this is
  // under <root>/.uploads/<user>/<uploadId>/; we remove it best-effort.
  await fs.rm(path.dirname(sessionFile), { recursive: true, force: true }).catch(() => undefined);

  // Verify the assembled file matches the declared size.
  if (totalSize !== meta.fileSize) {
    await storage.delete(storageKey).catch(() => undefined);
    return NextResponse.json(
      { error: `Размер файла не совпадает: ожидалось ${meta.fileSize}, получили ${totalSize}` },
      { status: 422 }
    );
  }

  // Create the DB record.
  // Use effectiveParentId (from the persisted session), NOT the raw query param.
  // Prefer the storage backend's hash if it computed one (it had to anyway);
  // fall back to our own hash if the backend didn't return one.
  const finalHash = putResult?.hashSha256 ?? hash.digest("hex");
  const node = await db.fileNode.create({
    data: {
      id: fileId,
      ownerId: user.id,
      parentId: effectiveParentId,
      name: safeName,
      storageKey,
      isDirectory: false,
      sizeBytes: BigInt(totalSize),
      mimeType,
      hashSha256: finalHash,
    },
  });

  // Update user.usedBytes incrementally — O(1) instead of O(N) tree walk.
  // totalSize is the actual assembled file size (verified above to match
  // meta.fileSize), so adding it to the cached counter is exactly correct.
  await db.user.update({
    where: { id: user.id },
    data: { usedBytes: { increment: BigInt(totalSize) } },
  });
  // user.usedBytes is the pre-upload cached value; newUsed reflects the
  // post-upload counter without an extra DB roundtrip.
  const newUsed = user.usedBytes + BigInt(totalSize);

  return NextResponse.json({
    uploadId: meta.uploadId,
    chunkIndex: meta.chunkIndex,
    received: true,
    finalized: true,
    file: {
      id: node.id,
      name: node.name,
      sizeBytes: node.sizeBytes.toString(),
      mimeType: node.mimeType,
    },
    usedBytes: newUsed.toString(),
  });
}

/**
 * DELETE — abort an in-progress chunked upload and clean up temp files.
 * Query: ?uploadId=<id>
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  if (!uploadId) {
    return NextResponse.json({ error: "Нужен uploadId" }, { status: 400 });
  }
  // Best-effort cleanup of any chunks we already received for this upload.
  // We don't know chunkTotal here, so we probe chunk indices until we hit a
  // missing one (storage.get throws) — at most MAX_CHUNK_PROBE attempts.
  const storage = await getStorage();
  for (let i = 0; i < MAX_CHUNK_PROBE; i++) {
    const ck = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${uploadId}/chunk-${i}`;
    try {
      await storage.delete(ck);
    } catch {
      break;
    }
  }
  // Also remove the local session.json marker if present.
  const sessionFile = path.join(
    uploadTempRoot(session.sub),
    uploadId,
    "session.json"
  );
  await fs.rm(path.dirname(sessionFile), { recursive: true, force: true }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

/**
 * #3 — Decode a URL-encoded filename safely.
 * Handles the case where the client double-encodes (sends %25D0 instead of %D0).
 * We try decodeURIComponent; if the result still contains % followed by hex,
 * we decode again (max 2 passes to prevent infinite loops).
 */
function safeDecodeURIComponent(input: string): string {
  let result = input;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break; // no change → already fully decoded
      result = decoded;
    } catch {
      break; // malformed → stop
    }
  }
  return result;
}

/**
 * Prefix for all temporary chunk storage keys. Stored under the same root
 * as user files but in a hidden `.uploads/` namespace that the file browser
 * never lists.
 */
const UPLOAD_TEMP_PREFIX = ".uploads";

/**
 * Local-filesystem path of the upload-session directory for a given user.
 * Used only for the session.json marker file (which persists parentId +
 * fileName across chunks). The chunk bytes themselves are stored via the
 * storage abstraction, not on the local FS directly.
 */
function uploadTempRoot(userId: string): string {
  // Prefer the DB-configured root (set via admin dashboard). Fall back to
  // env var, then to <cwd>/storage-data. This must match getLocalStorageRoot().
  const root = getCachedLocalStorageRoot() ?? path.join(process.cwd(), "storage-data");
  return path.join(root, ".uploads", userId);
}

/** Max chunks we'll probe when aborting an upload (safety cap). */
const MAX_CHUNK_PROBE = 100_000;
