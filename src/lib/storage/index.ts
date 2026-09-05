/**
 * Storage layer — local filesystem only.
 *
 * Files are stored under STORAGE_LOCAL_ROOT (or the admin-configured
 * `storageLocalRoot` setting). Single-node home deployment.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

export interface UploadResult {
  storageKey: string;
  sizeBytes: number;
  hashSha256?: string;
}

export interface StorageBackend {
  /** Persist a stream/buffer under a unique key. */
  put(key: string, data: Buffer | Readable | ReadableStream<Uint8Array>): Promise<UploadResult>;
  /** Fetch a file as a Node Readable stream (for piping to HTTP response). */
  get(key: string): Promise<Readable>;
  /** Fetch a byte range [start, end] inclusive as a Node Readable stream. */
  getRange(key: string, start: number, end: number): Promise<Readable>;
  /** Fetch a file fully into a Buffer (used for small previews). */
  getBuffer(key: string): Promise<Buffer>;
  /** Get a presigned or relative URL for direct access (optional). */
  getUrl?(key: string): Promise<string>;
  /** Delete a file. */
  delete(key: string): Promise<void>;
  /** Stat a file (size, mtime). */
  stat(key: string): Promise<{ size: number; mtime: Date }>;
  /**
   * List immediate children of a "directory" key (no recursion). Used by
   * chunked-upload abort to enumerate existing chunk files.
   */
  list(prefix: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Local filesystem backend
// ---------------------------------------------------------------------------

export class LocalFileStorage implements StorageBackend {
  constructor(private readonly root: string) {}

  /** The absolute filesystem path files are written to. */
  getRoot(): string {
    return this.root;
  }

  private resolve(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async put(key: string, data: Buffer | Readable | ReadableStream<Uint8Array>): Promise<UploadResult> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Write to a sibling temp file first and rename at the end. A crash
    // mid-write can then never leave a half-written file under its real
    // name — only an orphaned .tmp-*, which the janitor can sweep later.
    const tmpTarget = `${target}.tmp-${process.pid}-${Date.now()}`;

    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    let sizeBytes = 0;

    try {
      if (Buffer.isBuffer(data)) {
        hash.update(data);
        sizeBytes = data.byteLength;
        await fs.writeFile(tmpTarget, data);
      } else {
        const nodeStream = (data as ReadableStream<Uint8Array>).getReader
          ? Readable.fromWeb(data as ReadableStream<Uint8Array>)
          : (data as Readable);
        const { Transform } = await import("node:stream");
        const tap = new Transform({
          transform(chunk, _enc, cb) {
            hash.update(chunk);
            sizeBytes += chunk.byteLength;
            cb(null, chunk);
          },
        });
        const sink = await fs.open(tmpTarget, "w");
        const writeStream = sink.createWriteStream();
        try {
          const { pipeline } = await import("node:stream/promises");
          await pipeline(nodeStream, tap, writeStream);
        } catch (err) {
          writeStream.destroy();
          tap.destroy();
          await sink.close().catch(() => undefined);
          throw err;
        }
        await sink.close().catch(() => undefined);
      }

      // Rename is atomic on POSIX; on Windows it fails only if the
      // destination exists, which can't happen here (keys are unique).
      await fs.rename(tmpTarget, target);
    } catch (err) {
      await fs.unlink(tmpTarget).catch(() => undefined);
      throw err;
    }

    return { storageKey: key, sizeBytes, hashSha256: hash.digest("hex") };
  }

  /**
   * Sweep orphaned temp files left behind by crashed uploads.
   * Removes `.tmp-*` siblings older than maxAgeMs (default 24h).
   */
  async sweepTempFiles(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    let removed = 0;
    const stack = [this.root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // Don't descend into other users' trees more than needed —
          // but we must: tmp files live next to their targets.
          stack.push(full);
        } else if (e.name.includes(".tmp-")) {
          try {
            const s = await fs.stat(full);
            if (Date.now() - s.mtimeMs > maxAgeMs) {
              await fs.unlink(full);
              removed++;
            }
          } catch {}
        }
      }
    }
    return removed;
  }

  async get(key: string): Promise<Readable> {
    const target = this.resolve(key);
    const { createReadStream } = await import("node:fs");
    return createReadStream(target);
  }

  async getRange(key: string, start: number, end: number): Promise<Readable> {
    const target = this.resolve(key);
    const { createReadStream } = await import("node:fs");
    return createReadStream(target, { start, end });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const target = this.resolve(key);
    return fs.readFile(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await fs.unlink(target).catch(() => undefined);
  }

  async stat(key: string): Promise<{ size: number; mtime: Date }> {
    const target = this.resolve(key);
    const s = await fs.stat(target);
    return { size: s.size, mtime: s.mtime };
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix.replace(/\/$/, ""));
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOTDIR") return [];
      throw err;
    }
    const normalizedPrefix = prefix.endsWith("/") ? prefix : prefix + "/";
    return entries.map((name) => normalizedPrefix + name);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let cached: StorageBackend | null = null;
let cachedRoot: string | null = null;

/**
 * Return the effective local storage root.
 *
 * Priority:
 *   1. Admin-configured `storageLocalRoot` setting (from DB)
 *   2. STORAGE_LOCAL_ROOT env var
 *   3. <cwd>/storage-data
 */
export async function getLocalStorageRoot(): Promise<string> {
  try {
    const { getSetting } = await import("@/lib/cloud/settings");
    const override = await getSetting("storageLocalRoot");
    if (override) return override;
  } catch {
    // DB not available yet — fall through.
  }
  return process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
}

/** Sync accessor — may return null before first `getStorage()` call. */
export function getCachedLocalStorageRoot(): string | null {
  return cachedRoot ?? process.env.STORAGE_LOCAL_ROOT ?? null;
}

export async function getStorage(): Promise<StorageBackend> {
  if (cached) return cached;
  const root = await getLocalStorageRoot();
  cachedRoot = root;
  cached = new LocalFileStorage(root);
  return cached;
}

export function resetStorageCache(): void {
  cached = null;
  cachedRoot = null;
}

/**
 * Build a storage key. Format (v2, namespaced per user):
 *   users/<ownerId>/files/<fileId>/<safeName>
 *
 * Every user's data lives strictly inside their own directory, so a crash
 * or a bug can never mix one person's files into another's tree. Old keys
 * (<ownerId>/<fileId>/<name>) remain valid for existing FileNode rows —
 * they are read from `storageKey` in the DB. Use `migrate-storage-keys`
 * (scripts/) to move legacy files into the new layout.
 */
export function buildStorageKey(ownerId: string, fileId: string, name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return `users/${ownerId}/files/${fileId}/${safe}`;
}

/**
 * Guard: a storage key must live inside the owner's own directory.
 * Accepts both the v2 (`users/<id>/...`) and legacy (`<id>/...`) layouts.
 * Throws if a caller ever tries to write under someone else's namespace.
 */
export function assertStorageKeyOwner(key: string, ownerId: string): void {
  const parts = key.split("/");
  const ownerSegment =
    parts[0] === "users" && parts.length > 1 ? parts[1] : parts[0];
  if (!ownerSegment) {
    throw new Error(`Invalid storage key namespace: ${key}`);
  }
  if (ownerSegment !== ownerId) {
    throw new Error(
      `Storage key ${key} does not belong to owner ${ownerId} — refusing to write.`
    );
  }
}
