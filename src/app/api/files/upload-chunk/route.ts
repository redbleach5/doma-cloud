import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { sanitizeName, computeDirectorySize } from "@/lib/cloud/tree";
import { guessMime } from "@/lib/cloud/mime";
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
 */

const CHUNK_DIR_SUFFIX = ".chunks";
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

  const storageRoot = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");

  // #2 — CRITICAL: validate parentId on EVERY chunk, not just chunk 0.
  // The original code only checked on chunkIndex === 0, so an attacker could
  // send chunk 0 to root (no parentId) and then chunk 1+ with ?parentId=<target>
  // to hijack the file into a different folder.
  //
  // Solution: on chunk 0, verify the parent and persist it in a session file.
  // On subsequent chunks, IGNORE the ?parentId query param and use the
  // persisted value. This makes the upload session immutable.
  const sessionFile = path.join(
    storageRoot,
    ".uploads",
    session.sub,
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

  // Quota check on the first chunk.
  if (meta.chunkIndex === 0) {
    const user = await db.user.findUnique({ where: { id: session.sub } });
    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    const usedBytes = await computeDirectorySize(user.id, null);
    if (BigInt(usedBytes) + BigInt(meta.fileSize) > user.quotaBytes) {
      return NextResponse.json(
        { error: "Превышен лимит места", detail: { quota: user.quotaBytes.toString(), used: usedBytes.toString(), incoming: meta.fileSize } },
        { status: 413 }
      );
    }
  }

  // Resolve temp chunk directory.
  const storage = getStorage();
  const isLocal = process.env.STORAGE_DRIVER !== "s3";
  const tempDir = path.join(storageRoot, ".uploads", session.sub, meta.uploadId);

  if (isLocal) {
    await fs.mkdir(tempDir, { recursive: true });
  }

  // Write this chunk to its own file: <tempDir>/chunk-<index>
  const chunkPath = path.join(tempDir, `chunk-${meta.chunkIndex}`);
  const chunkStream = req.body;

  if (chunkStream) {
    // Stream the request body directly to the chunk file.
    const nodeStream = await import("node:stream").then((m) => m.Readable.fromWeb(chunkStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>));
    const sink = await fs.open(chunkPath, "w");
    const writeStream = sink.createWriteStream();
    try {
      await new Promise<void>((resolve, reject) => {
        nodeStream.pipe(writeStream);
        nodeStream.on("error", reject);
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);
      });
      await sink.close();
    } catch (err) {
      writeStream.destroy();
      await sink.close().catch(() => undefined);
      await fs.unlink(chunkPath).catch(() => undefined);
      throw err;
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

  // Concatenate all chunks into the final storage key — STREAMING, not
  // buffered. We pipe each chunk file through the hash + final write stream
  // one at a time, so memory stays flat regardless of total file size.
  const { createHash } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  let totalSize = 0;

  const finalPath = path.join(storageRoot, storageKey);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const finalSink = await fs.open(finalPath, "w");
  const finalWrite = finalSink.createWriteStream();

  try {
    for (let i = 0; i < meta.chunkTotal; i++) {
      const cp = path.join(tempDir, `chunk-${i}`);
      // Stream this chunk through hash + finalWrite — never loads the whole
      // chunk into memory at once (Node streams it in 64KB high-water marks).
      await new Promise<void>((resolve, reject) => {
        const chunkStream = createReadStream(cp);
        chunkStream.on("data", (chunk: Buffer) => {
          hash.update(chunk);
          totalSize += chunk.length;
          // Write to finalWrite; backpressure is handled by pipe.
          if (!finalWrite.write(chunk)) {
            chunkStream.pause();
            finalWrite.once("drain", () => chunkStream.resume());
          }
        });
        chunkStream.on("error", reject);
        chunkStream.on("end", resolve);
      });
      // Delete the chunk to free space as we go.
      await fs.unlink(cp).catch(() => undefined);
    }
    await new Promise<void>((resolve, reject) => {
      finalWrite.end(() => resolve());
      finalWrite.on("error", reject);
    });
    await finalSink.close();
  } catch (err) {
    finalWrite.destroy();
    await finalSink.close().catch(() => undefined);
    await fs.unlink(finalPath).catch(() => undefined);
    // Clean up any remaining chunks.
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  // Clean up the temp directory.
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

  // Verify the assembled file matches the declared size.
  if (totalSize !== meta.fileSize) {
    await fs.unlink(finalPath).catch(() => undefined);
    return NextResponse.json(
      { error: `Размер файла не совпадает: ожидалось ${meta.fileSize}, получили ${totalSize}` },
      { status: 422 }
    );
  }

  // Create the DB record.
  // Use effectiveParentId (from the persisted session), NOT the raw query param.
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
      hashSha256: hash.digest("hex"),
    },
  });

  // Update user.usedBytes.
  const newUsed = await computeDirectorySize(user.id, null);
  await db.user.update({ where: { id: user.id }, data: { usedBytes: newUsed } });

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
  const storageRoot = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
  const tempDir = path.join(storageRoot, ".uploads", session.sub, uploadId);
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
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
