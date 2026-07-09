/**
 * Filesystem tree helpers — pure functions over the FileNode table.
 */

import { db } from "@/lib/db";
import { buildStorageKey } from "@/lib/storage";
import { guessMime, categorize } from "./mime";

export interface FileNodeRow {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  isDirectory: boolean;
  sizeBytes: bigint;
  mimeType: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** List immediate children of a folder (or root if parentId is null). */
export async function listChildren(
  ownerId: string,
  parentId: string | null,
  includeDeleted = false
) {
  return db.fileNode.findMany({
    where: {
      ownerId,
      parentId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: [{ isDirectory: "desc" }, { name: "asc" }],
  });
}

/**
 * Recursively compute total size of a directory's non-deleted children.
 *
 * Used as a fallback for `user.usedBytes` recomputation and for subtree
 * size queries. For per-user totals prefer `recomputeUserUsedBytes` (one
 * SQL aggregate) or just read `user.usedBytes` directly (already maintained
 * incrementally by the upload/delete/restore routes).
 */
export async function computeDirectorySize(
  ownerId: string,
  parentId: string | null
): Promise<bigint> {
  const children = await db.fileNode.findMany({
    where: { ownerId, parentId, deletedAt: null },
    select: { id: true, isDirectory: true, sizeBytes: true },
  });
  let total = 0n;
  for (const child of children) {
    if (child.isDirectory) {
      total += await computeDirectorySize(ownerId, child.id);
    } else {
      total += child.sizeBytes;
    }
  }
  return total;
}

/**
 * Compute the total size of a subtree (sum of sizeBytes of every FILE node
 * at or below `nodeId`, regardless of deletedAt state). Used to decrement
 * `user.usedBytes` when a subtree is soft-deleted — much cheaper than
 * `computeDirectorySize(ownerId, null)` which traverses the whole tree.
 */
export async function computeSubtreeSize(
  ownerId: string,
  nodeId: string
): Promise<bigint> {
  const node = await db.fileNode.findUnique({
    where: { id: nodeId },
    select: { isDirectory: true, sizeBytes: true, ownerId: true },
  });
  if (!node || node.ownerId !== ownerId) return 0n;
  if (!node.isDirectory) return node.sizeBytes;
  let total = 0n;
  const children = await db.fileNode.findMany({
    where: { parentId: nodeId },
    select: { id: true, isDirectory: true, sizeBytes: true },
  });
  for (const child of children) {
    if (child.isDirectory) {
      total += await computeSubtreeSize(ownerId, child.id);
    } else {
      total += child.sizeBytes;
    }
  }
  return total;
}

/**
 * Recompute `user.usedBytes` from scratch with a single SQL aggregate query
 * and persist it to the DB. Use this when an incremental update is hard to
 * get right (e.g. partial restore of a subtree) or as a periodic sanity
 * check from the admin panel.
 *
 * Returns the recomputed total.
 */
export async function recomputeUserUsedBytes(userId: string): Promise<bigint> {
  const agg = await db.fileNode.aggregate({
    where: { ownerId: userId, isDirectory: false, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  const total = agg._sum.sizeBytes ?? 0n;
  await db.user.update({
    where: { id: userId },
    data: { usedBytes: total },
  });
  return total;
}

/** Recursively hard-delete file nodes (and their storage objects). */
export async function purgeSubtree(
  ownerId: string,
  nodeId: string,
  storage: { delete: (key: string) => Promise<void> }
): Promise<void> {
  const node = await db.fileNode.findUnique({ where: { id: nodeId } });
  if (!node) return;

  if (node.isDirectory) {
    const children = await db.fileNode.findMany({
      where: { parentId: nodeId },
      select: { id: true },
    });
    for (const child of children) {
      await purgeSubtree(ownerId, child.id, storage);
    }
  } else {
    try {
      await storage.delete(node.storageKey);
    } catch {
      // Best-effort — DB record is removed regardless.
    }
  }
  await db.fileNode.delete({ where: { id: nodeId } });
}

/** Create a directory (mkdir -p style: creates intermediate directories). */
export async function ensureDirectory(
  ownerId: string,
  pathSegments: string[]
): Promise<{ id: string; created: boolean } | null> {
  if (pathSegments.length === 0) return null;
  let parentId: string | null = null;
  let lastNode: { id: string; created: boolean } | null = null;
  for (const segment of pathSegments) {
    const existing = await db.fileNode.findFirst({
      where: { ownerId, parentId, name: segment, isDirectory: true, deletedAt: null },
    });
    if (existing) {
      parentId = existing.id;
      lastNode = { id: existing.id, created: false };
    } else {
      const created = await db.fileNode.create({
        data: {
          ownerId,
          parentId,
          name: segment,
          isDirectory: true,
          storageKey: buildStorageKey(ownerId, "dir-" + segment, ""),
          mimeType: "inode/directory",
        },
      });
      parentId = created.id;
      lastNode = { id: created.id, created: true };
    }
  }
  return lastNode;
}

/** Sanitize a filename for safe display. */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 240);
  // Empty or only underscores (input was all forbidden chars) → untitled.
  if (!cleaned || /^_+$/.test(cleaned)) return "untitled";
  return cleaned;
}

export { guessMime, categorize };
