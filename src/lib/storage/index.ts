/**
 * Storage abstraction layer.
 *
 * Doma Cloud can store files either on the local filesystem (default, great for
 * single-node home setup) or against an S3-compatible backend (MinIO). The
 * active backend is selected via the STORAGE_DRIVER env variable.
 *
 *   STORAGE_DRIVER=local  → LocalFileStorage     (default)
 *   STORAGE_DRIVER=s3     → S3FileStorage        (requires S3_* env vars)
 *
 * Both implementations expose the same interface, so the rest of the app does
 * not care where bytes actually land.
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
  /** Fetch a file fully into a Buffer (used for small previews). */
  getBuffer(key: string): Promise<Buffer>;
  /** Get a presigned or relative URL for direct access (optional). */
  getUrl?(key: string): Promise<string>;
  /** Delete a file. */
  delete(key: string): Promise<void>;
  /** Stat a file (size, mtime). */
  stat(key: string): Promise<{ size: number; mtime: Date }>;
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
    // Prevent path traversal: only allow keys under root.
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async put(key: string, data: Buffer | Readable | ReadableStream<Uint8Array>): Promise<UploadResult> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Compute size + hash while streaming.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    let sizeBytes = 0;

    if (Buffer.isBuffer(data)) {
      hash.update(data);
      sizeBytes = data.byteLength;
      await fs.writeFile(target, data);
    } else {
      // Stream (Node Readable or web ReadableStream) — pipe to file.
      // Memory stays flat regardless of file size: chunks flow from network
      // through the hash + write stream and are discarded.
      const nodeStream = (data as ReadableStream<Uint8Array>).getReader
        ? Readable.fromWeb(data as ReadableStream<Uint8Array>)
        : (data as Readable);
      // Track size + hash via a Transform that taps the stream without
      // consuming it. Using .on('data') + .pipe() together is unreliable
      // (can drop chunks or hang under backpressure).
      const { Transform } = await import("node:stream");
      const tap = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          sizeBytes += chunk.byteLength;
          cb(null, chunk);
        },
      });
      const sink = await fs.open(target, "w");
      const writeStream = sink.createWriteStream();
      try {
        const { pipeline } = await import("node:stream/promises");
        await pipeline(nodeStream, tap, writeStream);
      } catch (err) {
        // Stream failed mid-write (network drop, disk full, etc).
        // Close the file handle and delete the partial file so it doesn't
        // waste disk space or appear as a corrupt upload.
        writeStream.destroy();
        tap.destroy();
        await sink.close().catch(() => undefined);
        await fs.unlink(target).catch(() => undefined);
        throw err;
      }
      await sink.close().catch(() => undefined);
    }

    return { storageKey: key, sizeBytes, hashSha256: hash.digest("hex") };
  }

  async get(key: string): Promise<Readable> {
    const target = this.resolve(key);
    const { createReadStream } = await import("node:fs");
    return createReadStream(target);
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
 *   1. Admin-configured `storageLocalRoot` setting (from DB) — set via
 *      the admin dashboard. Lets the admin switch disks live.
 *   2. STORAGE_LOCAL_ROOT env var — set at deploy time.
 *   3. <cwd>/storage-data — fallback default.
 *
 * This function is async because reading the DB setting requires awaiting
 * Prisma. Callers should cache the result if they call it in a hot path.
 */
export async function getLocalStorageRoot(): Promise<string> {
  // Check DB setting first (admin override).
  try {
    const { getSetting } = await import("@/lib/cloud/settings");
    const override = await getSetting("storageLocalRoot");
    if (override) return override;
  } catch {
    // DB not available yet (e.g. during initial setup) — fall through.
  }
  return process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
}

/**
 * Return the current local storage root WITHOUT touching the DB.
 * Used for synchronous contexts (logging, display in error messages).
 * May return null if the async DB-backed resolver hasn't been called yet.
 */
export function getCachedLocalStorageRoot(): string | null {
  return cachedRoot ?? process.env.STORAGE_LOCAL_ROOT ?? null;
}

export async function getStorage(): Promise<StorageBackend> {
  if (cached) return cached;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    // Lazy import so we don't pay the cost when not needed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3FileStorage } = require("./storage-s3") as typeof import("./storage-s3");
    cached = new S3FileStorage({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION ?? "us-east-1",
      accessKey: process.env.S3_ACCESS_KEY!,
      secretKey: process.env.S3_SECRET_KEY!,
      bucket: process.env.S3_BUCKET!,
      forcePathStyle: true,
    });
  } else {
    const root = await getLocalStorageRoot();
    cachedRoot = root;
    cached = new LocalFileStorage(root);
  }
  return cached;
}

/**
 * Reset the cached storage backend. Call this after changing the
 * `storageLocalRoot` setting so the next `getStorage()` picks up the
 * new path.
 */
export function resetStorageCache(): void {
  cached = null;
  cachedRoot = null;
}

/** Build a content-addressed storage key. Format: <ownerId>/<fileId>/<safeName> */
export function buildStorageKey(ownerId: string, fileId: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  return `${ownerId}/${fileId}/${safe}`;
}
