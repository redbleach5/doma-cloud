/**
 * Shared upload pipeline core — single source of truth for the invariants
 * that BOTH upload endpoints (multipart `upload/route.ts` and resumable
 * `upload-chunk/route.ts`) must enforce identically:
 *
 *   1. Quota pre-check on declared sizes → 413 with {quota, used, incoming}
 *   2. Disk-space pre-flight (local backend, statfs, ~2× headroom) → 507
 *   3. Multipart file persistence with batch rollback on failure
 *   4. ATOMIC quota enforcement (conditional UPDATE) + rollback on race loss
 *
 * This module exists because this logic used to be copy-pasted into both
 * routes and the copies had already drifted (different detail shapes,
 * different disk-check styles, different rollback orders). The helpers here
 * only compute and enforce — they never shape HTTP responses; messages and
 * status codes stay at the call sites so each route keeps its user-facing
 * wording (e.g. the shared-folder path says «у владельца папки»).
 */
import { db } from "@/lib/db";
import {
  assertStorageKeyOwner,
  buildStorageKey,
  getCachedLocalStorageRoot,
  getStorage,
  LocalFileStorage,
} from "@/lib/storage";
import { sanitizeName } from "@/lib/cloud/tree";
import { guessMime } from "@/lib/cloud/mime";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

// ---------------------------------------------------------------------------
// Quota account
// ---------------------------------------------------------------------------

export interface QuotaAccount {
  id: string;
  usedBytes: bigint;
  quotaBytes: bigint;
}

/**
 * Load the account a quota check must run against. For shared-folder uploads
 * this is the SHARE OWNER (the resulting file counts against their quota),
 * not the authenticated recipient — callers decide whose id to pass.
 * Returns null when the row is missing (routes map that to 404).
 */
export async function loadQuotaAccount(userId: string): Promise<QuotaAccount | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, usedBytes: true, quotaBytes: true },
  });
}

/** Pure pre-check: would storing `incomingBytes` more exceed this quota? */
export function quotaWouldExceed(account: QuotaAccount, incomingBytes: number | bigint): boolean {
  return account.usedBytes + BigInt(incomingBytes) > account.quotaBytes;
}

/** The detail payload both routes attach to their 413 responses. */
export function quotaExceededDetail(account: QuotaAccount, incomingBytes: number | bigint) {
  return {
    quota: account.quotaBytes.toString(),
    used: account.usedBytes.toString(),
    incoming: Number(incomingBytes),
  };
}

// ---------------------------------------------------------------------------
// Disk space
// ---------------------------------------------------------------------------

export interface DiskSpaceCheck {
  /** false → the caller responds 507. */
  ok: boolean;
  freeBytes: bigint | null;
  /** Bytes that must be free for the upload to proceed (≈2× the payload). */
  neededBytes: bigint | null;
}

/**
 * Pre-flight disk-space check for the local storage backend. Requires ~2×
 * the incoming bytes: the write itself plus headroom for SQLite WAL/journal
 * growth during the same window. Skipped — returns ok — when the backend is
 * not the local filesystem or statfs is unavailable; a failed estimate must
 * never block an upload on exotic filesystems.
 */
export async function checkDiskSpace(
  storage: unknown,
  requiredBytes: bigint
): Promise<DiskSpaceCheck> {
  const root =
    storage instanceof LocalFileStorage ? storage.getRoot() : getCachedLocalStorageRoot();
  if (!root) return { ok: true, freeBytes: null, neededBytes: null };
  try {
    const stat = await fs.statfs(root);
    const freeBytes = BigInt(stat.bsize) * BigInt(stat.bavail);
    const neededBytes = requiredBytes * 2n;
    return { ok: freeBytes >= neededBytes, freeBytes, neededBytes };
  } catch {
    return { ok: true, freeBytes: null, neededBytes: null };
  }
}


// ---------------------------------------------------------------------------
// Atomic quota enforcement + rollback
// ---------------------------------------------------------------------------

export interface QuotaEnforcement {
  /** false → a concurrent upload consumed the quota first; roll back. */
  enforced: boolean;
  /** Fresh usedBytes after the increment; null only if the post-read failed. */
  usedBytes: bigint | null;
}

/**
 * ATOMIC quota enforcement — a conditional UPDATE prevents TOCTOU races where
 * two parallel uploads both pass the pre-check and then both increment,
 * exceeding the quota. If 0 rows are affected, a concurrent upload won; the
 * caller must roll back everything it created for this request.
 */
export async function enforceQuotaAtomically(
  ownerId: string,
  addBytes: bigint
): Promise<QuotaEnforcement> {
  const updated = await db.$executeRaw`
    UPDATE User
    SET usedBytes = usedBytes + ${addBytes}
    WHERE id = ${ownerId}
      AND usedBytes + ${addBytes} <= quotaBytes
  `;
  if (updated === 0) return { enforced: false, usedBytes: null };
  const refreshed = await db.user.findUnique({
    where: { id: ownerId },
    select: { usedBytes: true },
  });
  return { enforced: true, usedBytes: refreshed?.usedBytes ?? null };
}

export interface StoredFileRef {
  id: string;
  ownerId: string;
  name: string;
}

/**
 * Best-effort rollback of created files: delete the stored objects first,
 * then their FileNode rows. Storage-before-DB means a crash mid-rollback
 * leaves at worst an orphan file on disk (repaired by the orphan scan /
 * recompute-quotas), never a DB row pointing at a missing object.
 */
export async function rollbackStoredFiles(
  files: StoredFileRef[],
  storage: { delete(key: string): Promise<void> }
): Promise<void> {
  for (const f of files) {
    await storage.delete(buildStorageKey(f.ownerId, f.id, f.name)).catch(() => undefined);
  }
  for (const f of files) {
    await db.fileNode.delete({ where: { id: f.id } }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Multipart persistence (used by both paths of upload/route.ts)
// ---------------------------------------------------------------------------

export interface PersistedFile {
  id: string;
  name: string;
  sizeBytes: string;
  mimeType: string;
}

export type PersistFilesResult =
  | { created: PersistedFile[] }
  | { error: string; status: number };

/**
 * Persist multipart `File` objects into storage + DB. Streams each file
 * directly to disk (flat memory profile), creates the FileNode only after
 * the storage write succeeded, and rolls back the whole batch (storage +
 * DB) on any failure.
 *
 * CRITICAL: files are streamed directly to storage — memory usage stays flat
 * regardless of file size. A 20 GB video uses the same ~50 MB of RAM as a
 * 1 KB text file.
 */
export async function persistMultipartFiles(
  files: File[],
  parentId: string | null,
  ownerId: string,
  storage: Awaited<ReturnType<typeof getStorage>>
): Promise<PersistFilesResult> {
  const created: PersistedFile[] = [];

  const rollbackCreated = async () => {
    await rollbackStoredFiles(
      created.map((c) => ({ id: c.id, ownerId, name: c.name })),
      storage
    );
  };

  for (const file of files) {
    const safeName = sanitizeName(file.name);
    const fileId = randomUUID();
    const storageKey = buildStorageKey(ownerId, fileId, safeName);
    // Hard guard: never write outside the owner's own directory.
    assertStorageKeyOwner(storageKey, ownerId);
    const mimeType = file.type || guessMime(safeName);

    let result;
    try {
      result = await storage.put(
        storageKey,
        file.stream() as unknown as import("node:stream/web").ReadableStream<Uint8Array>
      );
    } catch (err) {
      await rollbackCreated();
      const msg = err instanceof Error ? err.message : "Ошибка записи";
      return { error: `Не удалось сохранить «${safeName}»: ${msg}`, status: 500 };
    }

    let node;
    try {
      node = await db.fileNode.create({
        data: {
          id: fileId,
          ownerId,
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
      await storage.delete(storageKey).catch(() => undefined);
      await rollbackCreated();
      console.error("[upload] DB write failed, rolled back batch:", dbErr);
      return { error: "Ошибка базы данных при записи файла", status: 500 };
    }

    created.push({
      id: node.id,
      name: node.name,
      sizeBytes: node.sizeBytes.toString(),
      mimeType: node.mimeType,
    });
  }

  return { created };
}
