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

/** Recursively compute total size of a directory. */
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
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 240) || "untitled";
}

export { guessMime, categorize };
