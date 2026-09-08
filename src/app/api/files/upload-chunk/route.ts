import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage, buildStorageKey, assertStorageKeyOwner, getCachedLocalStorageRoot, LocalFileStorage } from "@/lib/storage";
import { sanitizeName, resolveFolderAccess, hasPermission } from "@/lib/cloud/tree";
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
 * Storage: chunks land in `<root>/.uploads/<user>/<uploadId>/` and are
 * concatenated on the final chunk into the permanent storage key.
 */


/**
 * Structured upload logging — writes to logs/upload-debug.log
 * Helps diagnose client-side issues (network errors, size mismatches, etc.)
 */
async function logUploadEvent(event: {
  level: "info" | "warn" | "error";
  userId: string;
  uploadId?: string;
  fileName?: string;
  fileSize?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  message: string;
  error?: unknown;
  durationMs?: number;
}): Promise<void> {
  try {
    const logDir = path.join(process.cwd(), "logs");
    await fs.mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString();
    const parts = [
      ts,
      `[${event.level.toUpperCase()}]`,
      `user=${event.userId}`,
      event.uploadId ? `upload=${event.uploadId}` : null,
      event.fileName ? `file="${event.fileName}"` : null,
      event.fileSize ? `size=${event.fileSize}` : null,
      event.chunkIndex !== undefined ? `chunk=${event.chunkIndex}/${event.chunkTotal}` : null,
      event.durationMs !== undefined ? `duration=${event.durationMs}ms` : null,
      event.message,
    ].filter(Boolean);

    let line = parts.join(" ");

    if (event.error) {
      const err = event.error instanceof Error
        ? `${event.error.name}: ${event.error.message}\n${event.error.stack ?? ""}`
        : String(event.error);
      line += `\n  ERROR: ${err}`;
    }

    line += "\n";
    await fs.appendFile(path.join(logDir, "upload-debug.log"), line);
    console.log(`[upload] ${line.trim()}`);
  } catch {
    // swallow — logging must never break the upload
  }
}


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
  // CRITICAL: uploadId is used to build filesystem paths (session.json lives
  // at <root>/.uploads/<user>/<uploadId>/session.json). Without validation,
  // an attacker could send `X-Upload-Id: ../../../../tmp/pwned` and write
  // session.json (with controlled JSON content) into arbitrary directories —
  // or trigger recursive `fs.rm` on arbitrary paths via the abort endpoint.
  // We restrict to URL-safe characters and a sane length.
  if (!uploadId || !/^[A-Za-z0-9_-]{1,64}$/.test(uploadId)) return null;

  // #3 — Client sends encodeURIComponent(file.name) in X-File-Name.
  // We MUST decode it here, otherwise the file is saved with a URL-encoded
  // name on disk (e.g. %D0%BA%D0%B8%D1%80.txt instead of кириллица.txt).
  const rawFileName = req.headers.get("x-file-name");
  const fileName = rawFileName ? safeDecodeURIComponent(rawFileName) : null;
  const fileSize = parseInt(req.headers.get("x-file-size") ?? "0", 10);
  const fileMime = req.headers.get("x-file-mime") ?? "application/octet-stream";
  const chunkIndex = parseInt(req.headers.get("x-chunk-index") ?? "0", 10);
  const chunkTotal = parseInt(req.headers.get("x-chunk-total") ?? "0", 10);

  if (!fileName || !fileSize || !chunkTotal) return null;
  if (chunkIndex < 0 || chunkIndex >= chunkTotal) return null;
  if (fileSize > Number.MAX_SAFE_INTEGER) return null;
  if (chunkTotal > 20_000) return null; // 20k chunks × 5MB = 100GB cap

  return { uploadId, fileName, fileSize, fileMime, chunkIndex, chunkTotal };
}

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const session = await getSession();
  if (!session) {
    await logUploadEvent({
      level: "warn",
      userId: "anonymous",
      message: "Unauthorized upload attempt",
    });
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const userId = session.sub;

  // Rate limit — dedicated bucket so large chunked uploads are not starved
  // by the multipart upload limit (100/min).
  const rl = rateLimit(
    `upload-chunk:${session.sub}`,
    LIMITS.uploadChunk.limit,
    LIMITS.uploadChunk.windowMs
  );
  if (!rl.allowed) {
    await logUploadEvent({
      level: "warn",
      userId,
      message: `Rate limited: ${rl.resetAt - Date.now()}ms remaining`,
    });
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
    await logUploadEvent({
      level: "warn",
      userId,
      message: "Invalid chunk headers",
    });
    return NextResponse.json({ error: "Неверные заголовки чанка" }, { status: 400 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_CHUNK_SIZE) {
    await logUploadEvent({
      level: "warn",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: `Chunk too large: ${contentLength} bytes (max ${MAX_CHUNK_SIZE})`,
    });
    return NextResponse.json(
      { error: `Чанк слишком большой (макс ${MAX_CHUNK_SIZE / 1024 / 1024} МБ)` },
      { status: 413 }
    );
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;
  const sharedFolderId = url.searchParams.get("sharedFolderId") || null;

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
  let effectiveOwnerId: string = session.sub;  // who owns the resulting FileNode
  let effectiveSharedFolderId: string | null = null;

  if (meta.chunkIndex === 0) {
    if (sharedFolderId) {
      // ---- Shared-folder upload ----
      const share = await db.sharedItem.findUnique({
        where: { id: sharedFolderId },
        select: {
          id: true, nodeId: true, recipientId: true, ownerId: true, permission: true,
          node: { select: { deletedAt: true, isDirectory: true } },
        },
      });
      if (!share || share.recipientId !== session.sub) {
        return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
      }
      if (share.node.deletedAt || !share.node.isDirectory) {
        return NextResponse.json({ error: "Папка больше не доступна" }, { status: 410 });
      }
      if (!hasPermission(
        { kind: "shared", userId: session.sub, sharedFolderId: share.id, rootFolderId: share.nodeId, permission: share.permission as "view" | "upload" | "edit" },
        "upload"
      )) {
        return NextResponse.json(
          { error: "Недостаточно прав — нужна permission 'upload' или 'edit'" },
          { status: 403 }
        );
      }
      if (parentId === null) {
        effectiveParentId = share.nodeId;
      } else {
        const ctx = await resolveFolderAccess(session.sub, parentId);
        if (!ctx || ctx.kind !== "shared" || ctx.rootFolderId !== share.nodeId) {
          return NextResponse.json({ error: "Папка вне области доступа" }, { status: 403 });
        }
        effectiveParentId = parentId;
      }
      effectiveOwnerId = share.ownerId;  // uploaded file belongs to the owner
      effectiveSharedFolderId = share.id;
    } else if (parentId) {
      // ---- Owner upload into a subfolder ----
      const parent = await db.fileNode.findFirst({
        where: { id: parentId, ownerId: session.sub, isDirectory: true, deletedAt: null },
      });
      if (!parent) {
        await logUploadEvent({
          level: "warn",
          userId,
          uploadId: meta.uploadId,
          fileName: meta.fileName,
          message: `Parent folder not found: ${parentId}`,
        });
        return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
      }
      effectiveParentId = parentId;
    }
    // Persist session metadata through the storage abstraction so chunked
    // uploads work across restarts. Chunk N+1 reads the same session.json
    // that chunk 0 wrote.
    const storage0 = await getStorage();
    const sessionKey = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/session.json`;
    await storage0.put(sessionKey, Buffer.from(JSON.stringify({
      parentId: effectiveParentId,
      ownerId: effectiveOwnerId,
      sharedFolderId: effectiveSharedFolderId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
    }), "utf-8"));
  } else {
    // Subsequent chunk — read the persisted session via storage abstraction.
    const storage0 = await getStorage();
    const sessionKey = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/session.json`;
    try {
      const buf = await storage0.getBuffer(sessionKey);
      const sessionData = JSON.parse(buf.toString("utf-8"));
      effectiveParentId = sessionData.parentId ?? null;
      effectiveOwnerId = sessionData.ownerId ?? session.sub;
      effectiveSharedFolderId = sessionData.sharedFolderId ?? null;
    } catch {
      await logUploadEvent({
        level: "warn",
        userId,
        uploadId: meta.uploadId,
        fileName: meta.fileName,
        chunkIndex: meta.chunkIndex,
        message: "Session not found (expired or cleanup)",
      });
      return NextResponse.json(
        { error: "Upload session not found. Restart the upload." },
        { status: 410 }
      );
    }
  }

  // Quota check on the first chunk — atomic conditional UPDATE prevents
  // TOCTOU races where two parallel uploads both pass the check and then both
  // increment, exceeding the quota. We re-check atomically on the LAST chunk
  // too (where the actual increment happens).
  //
  // For shared-folder uploads, quota is checked against the OWNER's account
  // (the resulting FileNode is owned by them, not the recipient).
  if (meta.chunkIndex === 0) {
    const user = await db.user.findUnique({ where: { id: effectiveOwnerId } });
    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (user.usedBytes + BigInt(meta.fileSize) > user.quotaBytes) {
      await logUploadEvent({
        level: "warn",
        userId,
        uploadId: meta.uploadId,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        message: `Quota exceeded: used=${user.usedBytes}, quota=${user.quotaBytes}, incoming=${meta.fileSize}`,
      });
      return NextResponse.json(
        { error: "Превышен лимит места", detail: { quota: user.quotaBytes.toString(), used: user.usedBytes.toString(), incoming: meta.fileSize } },
        { status: 413 }
      );
    }
  }

  // Write this chunk to its own temp storage key: .uploads/<user>/<uploadId>/chunk-<index>
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
      await logUploadEvent({
        level: "error",
        userId,
        uploadId: meta.uploadId,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        chunkIndex: meta.chunkIndex,
        chunkTotal: meta.chunkTotal,
        message: `Failed to write chunk: ${msg}`,
        error: err,
        durationMs: Date.now() - requestStart,
      });
      return NextResponse.json(
        { error: `Не удалось сохранить чанк: ${msg}` },
        { status: 500 }
      );
    }
  }

  // If this is NOT the last chunk, acknowledge and wait for more.
  if (meta.chunkIndex < meta.chunkTotal - 1) {
    await logUploadEvent({
      level: "info",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      chunkIndex: meta.chunkIndex,
      chunkTotal: meta.chunkTotal,
      message: "Chunk received OK",
      durationMs: Date.now() - requestStart,
    });
    return NextResponse.json({
      uploadId: meta.uploadId,
      chunkIndex: meta.chunkIndex,
      received: true,
      finalized: false,
    });
  }

  // LAST CHUNK — claim finalization atomically via O_EXCL marker on disk.
  const finalizingKey = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/.finalizing`;
  try {
    const localPath = (storage as LocalFileStorage).getRoot();
    const fullPath = path.join(localPath, finalizingKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const fh = await fs.open(fullPath, "wx");
    await fh.writeFile(String(process.pid));
    await fh.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return NextResponse.json(
        { error: "Upload is already being finalized by another request" },
        { status: 409 }
      );
    }
    console.warn(`[upload-chunk] finalizing marker error for ${meta.uploadId}:`, err);
    await logUploadEvent({
      level: "error",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: "Finalizing marker error",
      error: err,
    });
  }

  // LAST CHUNK — assemble the final file.
  //
  // IMPORTANT: we look up the OWNER's user record (which may be different
  // from the authenticated user when uploading into a shared folder — the
  // file belongs to the share owner, not the recipient).
  const user = await db.user.findUnique({ where: { id: effectiveOwnerId } });
  if (!user) {
    await logUploadEvent({
      level: "error",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: `Owner not found: ${effectiveOwnerId}`,
    });
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  // Disk-space pre-check before assembly.
  const localRoot = getCachedLocalStorageRoot();
  if (localRoot) {
    try {
      const stat = await fs.statfs(localRoot);
      const freeBytes = BigInt(stat.bavail) * BigInt(stat.bsize);
      const needed = BigInt(meta.fileSize) * 2n;
      if (freeBytes < needed) {
        await logUploadEvent({
          level: "error",
          userId,
          uploadId: meta.uploadId,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          message: `Insufficient disk space: need ${needed}, have ${freeBytes}`,
        });
        return NextResponse.json(
          { error: "Недостаточно свободного места на диске для сборки файла" },
          { status: 507 }
        );
      }
    } catch {
      // statfs may fail on exotic filesystems — don't block the upload.
    }
  }

  const safeName = sanitizeName(meta.fileName);
  const fileId = randomUUID();
  const storageKey = buildStorageKey(user.id, fileId, safeName);
  // Hard guard: never write outside the owner's own directory.
  assertStorageKeyOwner(storageKey, user.id);
  const mimeType = meta.fileMime || guessMime(safeName);

  // Concatenate all chunks into the final storage key.
  //
  // We use `Readable.from(async generator)` so backpressure is handled
  // correctly by Node. The previous implementation used a manually-constructed
  // `new Readable({ read() {} })` with an external IIFE pushing data and
  // waiting for `'drain'` — but `Readable` does not emit `'drain'` (that's a
  // `Writable` event), so the producer would hang forever once the internal
  // buffer hit highWaterMark (~16 KB). On slow disks this deadlocked
  // every chunked upload past the first 16 KB.
  const { createHash } = await import("node:crypto");
  const { Readable } = await import("node:stream");
  const hash = createHash("sha256");
  let totalSize = 0;

  const compositeStream = Readable.from((async function* () {
    for (let i = 0; i < meta.chunkTotal; i++) {
      const ck = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/chunk-${i}`;
      const chunkReadable = await storage.get(ck);
      for await (const buf of chunkReadable) {
        const b = buf as Buffer;
        hash.update(b);
        totalSize += b.length;
        yield b;
      }
      // Delete the chunk to free space as we go.
      await storage.delete(ck).catch(() => undefined);
    }
  })());

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
    await logUploadEvent({
      level: "error",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: `Assembly failed: ${msg}`,
      error: err,
      durationMs: Date.now() - requestStart,
    });
    return NextResponse.json(
      { error: `Не удалось собрать файл: ${msg}` },
      { status: 500 }
    );
  }

  // Clean up the session metadata + finalizing marker through the storage
  // abstraction. Previously this used fs.rm on a local path which only
  // worked for LocalFileStorage.
  await storage.delete(`${UPLOAD_TEMP_PREFIX}/${session.sub}/${meta.uploadId}/session.json`).catch(() => undefined);
  await storage.delete(finalizingKey).catch(() => undefined);
  // Also best-effort clean up any local FS remnants from older code paths.
  await fs.rm(path.dirname(sessionFile), { recursive: true, force: true }).catch(() => undefined);

  // Verify the assembled file matches the declared size BEFORE creating
  // any DB/quota side effects. Crash here leaves only a final object which
  // we delete below on mismatch (and best-effort on other failures).
  if (totalSize !== meta.fileSize) {
    await storage.delete(storageKey).catch(() => undefined);
    await logUploadEvent({
      level: "error",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: `Size mismatch: expected ${meta.fileSize}, got ${totalSize} (${meta.chunkTotal} chunks)`,
      durationMs: Date.now() - requestStart,
    });
    return NextResponse.json(
      { error: `Размер файла не совпадает: ожидалось ${meta.fileSize}, получили ${totalSize}` },
      { status: 422 }
    );
  }

  const finalHash = putResult?.hashSha256 ?? hash.digest("hex");

  // Create the FileNode FIRST, then atomically claim quota.
  // Previous order (usedBytes += then create) left inflated quota + orphan
  // disk bytes if the process died between the two steps.
  // Under-counted usedBytes (create ok, crash before quota ++) is repaired
  // by admin recompute-quotas and is far safer than "quota eaten, no file".
  let node;
  try {
    node = await db.fileNode.create({
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
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    const msg = err instanceof Error ? err.message : "Ошибка записи в БД";
    await logUploadEvent({
      level: "error",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: `Database error: ${msg}`,
      error: err,
      durationMs: Date.now() - requestStart,
    });
    return NextResponse.json({ error: `Не удалось сохранить файл: ${msg}` }, { status: 500 });
  }

  // ATOMIC quota enforcement — conditional UPDATE. If 0 rows are affected,
  // a concurrent upload won the race; roll back the FileNode + storage object.
  const quotaResult = await db.$executeRaw`
    UPDATE User
    SET usedBytes = usedBytes + ${BigInt(totalSize)}
    WHERE id = ${user.id}
      AND usedBytes + ${BigInt(totalSize)} <= quotaBytes
  `;
  if (quotaResult === 0) {
    await db.fileNode.delete({ where: { id: fileId } }).catch(() => undefined);
    await storage.delete(storageKey).catch(() => undefined);
    await logUploadEvent({
      level: "warn",
      userId,
      uploadId: meta.uploadId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      message: "Quota exceeded (concurrent upload race)",
      durationMs: Date.now() - requestStart,
    });
    return NextResponse.json(
      { error: "Превышен лимит места (конкурентная загрузка)" },
      { status: 413 }
    );
  }

  // Read the freshly-updated usedBytes to return to the client.
  const refreshed = await db.user.findUnique({
    where: { id: user.id },
    select: { usedBytes: true },
  });
  const newUsed = refreshed?.usedBytes ?? user.usedBytes + BigInt(totalSize);

  await logUploadEvent({
    level: "info",
    userId,
    uploadId: meta.uploadId,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    message: `Upload finalized successfully: fileId=${node.id}, chunks=${meta.chunkTotal}, hash=${finalHash.slice(0, 16)}...`,
    durationMs: Date.now() - requestStart,
  });

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
 *
 * GET — resume status for an in-progress upload.
 * Query: ?uploadId=<id>
 * Returns which chunk indices exist so the client can skip re-uploading them
 * after a browser tab close.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  if (!uploadId) {
    return NextResponse.json({ error: "Нужен uploadId" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uploadId)) {
    return NextResponse.json({ error: "Некорректный uploadId" }, { status: 400 });
  }

  const storage = await getStorage();
  const sessionKey = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${uploadId}/session.json`;
  let sessionData: {
    parentId?: string | null;
    ownerId?: string;
    sharedFolderId?: string | null;
    fileName?: string;
    fileSize?: number;
  } | null = null;
  try {
    const buf = await storage.getBuffer(sessionKey);
    sessionData = JSON.parse(buf.toString("utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Upload session not found", exists: false },
      { status: 410 }
    );
  }

  const prefix = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${uploadId}/`;
  const keys =
    typeof storage.list === "function"
      ? await storage.list(prefix).catch(() => [] as string[])
      : [];
  const receivedChunks: number[] = [];
  for (const key of keys) {
    const base = key.split("/").pop() ?? "";
    const m = /^chunk-(\d+)$/.exec(base);
    if (m) receivedChunks.push(parseInt(m[1]!, 10));
  }
  receivedChunks.sort((a, b) => a - b);

  // Next index = first gap in 0..max, or max+1 if contiguous from 0.
  let nextChunkIndex = 0;
  for (const idx of receivedChunks) {
    if (idx === nextChunkIndex) nextChunkIndex += 1;
    else if (idx > nextChunkIndex) break;
  }

  // Original chunk size (chunk-0's byte length). The client re-slices the file
  // with it when resuming so offsets match the original session — even if its
  // CHUNK_SIZE constant changed between app versions (see the resume logic in
  // src/lib/cloud/api.ts). Sourced from the stored chunk-0 file itself (not
  // session.json), so pre-existing sessions are covered too. Only meaningful
  // when chunk-0 exists — exactly the case nextChunkIndex > 0, which is the
  // only case the client reads this field; otherwise null.
  let chunkSize: number | null = null;
  if (receivedChunks.length > 0 && receivedChunks[0] === 0) {
    chunkSize = await storage
      .stat(`${prefix}chunk-0`)
      .then((s) => s.size)
      .catch(() => null);
  }

  return NextResponse.json({
    exists: true,
    uploadId,
    fileName: sessionData?.fileName ?? null,
    fileSize: sessionData?.fileSize ?? null,
    parentId: sessionData?.parentId ?? null,
    sharedFolderId: sessionData?.sharedFolderId ?? null,
    receivedChunks,
    nextChunkIndex,
    chunkSize,
  });
}

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
  // CRITICAL: same validation as parseMeta() — uploadId is used to build
  // filesystem paths (session.json marker + recursive fs.rm on abort).
  // Without this, `?uploadId=../../etc` would recursively delete arbitrary
  // directories. POST validates via parseMeta(); DELETE must too.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uploadId)) {
    return NextResponse.json({ error: "Некорректный uploadId" }, { status: 400 });
  }
  // Best-effort cleanup of any chunks we already received for this upload.
  // Use storage.list() (when available) to enumerate the actual chunk files
  // and delete only those. Previously this probed chunk-0..chunk-99999 via
  // storage.delete and broke on the first throw — but LocalFileStorage.delete
  // swallows ENOENT, so the loop ran the full 100 000 iterations of unlink()
  // syscalls on every abort, which any authenticated user could DoS.
  const storage = await getStorage();
  const chunkPrefix = `${UPLOAD_TEMP_PREFIX}/${session.sub}/${uploadId}/`;
  if (typeof storage.list === "function") {
    const chunkKeys = await storage.list(chunkPrefix).catch(() => [] as string[]);
    await Promise.all(
      chunkKeys.map((ck) => storage.delete(ck).catch(() => undefined))
    );
  } else {
    for (let i = 0; i < MAX_CHUNK_PROBE; i++) {
      const ck = `${chunkPrefix}chunk-${i}`;
      try {
        await storage.delete(ck);
      } catch {
        break;
      }
    }
  }
  // Also remove the local session.json marker if present (legacy path).
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

/** Max chunks we'll probe when aborting an upload (safety cap).
 *  Matches the 20k chunkTotal cap from parseMeta. Used only as a fallback
 *  when the storage backend doesn't implement list(). */
const MAX_CHUNK_PROBE = 20_000;
