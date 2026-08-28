/**
 * Filesystem tree helpers — pure functions over the FileNode table.
 *
 * Two access modes are supported:
 *   - owner  — the user owns the subtree (original behaviour).
 *   - shared — the user is the recipient of a SharedItem whose root is
 *              an ancestor of (or equal to) the node being operated on.
 *              The recipient's permission (view / upload / edit) controls
 *              what they can do, but tree helpers here only enforce
 *              reachability — permission checks live in the route handlers.
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

// ---------------------------------------------------------------------------
// Viewer context — describes HOW a user is allowed to see a node.
// ---------------------------------------------------------------------------

export type Permission = "view" | "upload" | "edit";

export type ViewerContext =
  | { kind: "owner"; userId: string }
  | {
      kind: "shared";
      userId: string;
      /** SharedItem.id — clients still pass this as `sharedFolderId` query param. */
      sharedFolderId: string;
      /** FileNode.id of the share root (folder OR file). */
      rootFolderId: string;
      permission: Permission;
    };

/**
 * Resolve how (and whether) `userId` may access `folderId`.
 *
 *  - null  → no access (folder doesn't exist, is trashed, is not a directory,
 *            or is neither owned by the user nor shared with them).
 *  - { kind: "owner" } → the user owns the folder (full control).
 *  - { kind: "shared", ... } → the folder is inside (or is) a folder that
 *    has been shared with the user. `rootFolderId` is the share root, and
 *    `permission` is the recipient's permission level.
 *
 * For `folderId === null` (root), only `{ kind: "owner" }` is ever returned
 * — root is per-user and cannot be shared.
 */
export async function resolveFolderAccess(
  userId: string,
  folderId: string | null
): Promise<ViewerContext | null> {
  if (folderId === null) {
    return { kind: "owner", userId };
  }

  const node = await db.fileNode.findUnique({
    where: { id: folderId },
    select: { ownerId: true, isDirectory: true, deletedAt: true, parentId: true },
  });
  if (!node || node.deletedAt || !node.isDirectory) return null;

  if (node.ownerId === userId) {
    return { kind: "owner", userId };
  }

  const rows = await db.$queryRaw<
    Array<{ id: string; nodeId: string; permission: string }>
  >`
    WITH RECURSIVE ancestors(id, parentId) AS (
      SELECT id, parentId FROM FileNode WHERE id = ${folderId}
      UNION ALL
      SELECT fn.id, fn.parentId
      FROM FileNode fn
      JOIN ancestors a ON fn.id = a.parentId
    )
    SELECT si.id, si.nodeId, si.permission
    FROM ancestors a
    JOIN SharedItem si ON si.nodeId = a.id
    WHERE si.recipientId = ${userId}
    ORDER BY CASE WHEN si.nodeId = ${folderId} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const share = rows[0]!;
  return {
    kind: "shared",
    userId,
    sharedFolderId: share.id,
    rootFolderId: share.nodeId,
    permission: share.permission as Permission,
  };
}

/**
 * Resolve access for a generic node (file OR directory).
 *
 * Order:
 *   1. Owner
 *   2. Direct SharedItem on the node itself (file or folder share root)
 *   3. Ancestor SharedItem walk (file inside a shared folder, or nested dir)
 */
export async function resolveNodeAccess(
  userId: string,
  nodeId: string
): Promise<{
  ctx: ViewerContext;
  node: {
    id: string;
    ownerId: string;
    isDirectory: boolean;
    parentId: string | null;
    deletedAt: Date | null;
    storageKey: string;
    name: string;
    mimeType: string;
    sizeBytes: bigint;
    updatedAt: Date;
  };
} | null> {
  const node = await db.fileNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      ownerId: true,
      isDirectory: true,
      parentId: true,
      deletedAt: true,
      storageKey: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });
  if (!node || node.deletedAt) return null;

  if (node.ownerId === userId) {
    return { ctx: { kind: "owner", userId }, node };
  }

  // Direct share on this node (critical for shared files).
  const direct = await db.sharedItem.findFirst({
    where: { nodeId: node.id, recipientId: userId },
    select: { id: true, nodeId: true, permission: true },
  });
  if (direct) {
    return {
      ctx: {
        kind: "shared",
        userId,
        sharedFolderId: direct.id,
        rootFolderId: direct.nodeId,
        permission: direct.permission as Permission,
      },
      node,
    };
  }

  // Ancestor walk — start from the node itself for dirs, parent for files.
  const startCursor = node.isDirectory ? node.id : node.parentId;
  if (startCursor === null) return null;

  const rows = await db.$queryRaw<
    Array<{ id: string; nodeId: string; permission: string }>
  >`
    WITH RECURSIVE ancestors(id, parentId) AS (
      SELECT id, parentId FROM FileNode WHERE id = ${startCursor}
      UNION ALL
      SELECT fn.id, fn.parentId
      FROM FileNode fn
      JOIN ancestors a ON fn.id = a.parentId
    )
    SELECT si.id, si.nodeId, si.permission
    FROM ancestors a
    JOIN SharedItem si ON si.nodeId = a.id
    WHERE si.recipientId = ${userId}
    ORDER BY CASE WHEN si.nodeId = ${startCursor} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const share = rows[0]!;
  return {
    ctx: {
      kind: "shared",
      userId,
      sharedFolderId: share.id,
      rootFolderId: share.nodeId,
      permission: share.permission as Permission,
    },
    node,
  };
}

// ---------------------------------------------------------------------------
// List / size / purge helpers.
 // ---------------------------------------------------------------------------

/** Default / max page sizes for folder listings. */
export const LIST_PAGE_DEFAULT = 100;
export const LIST_PAGE_MAX = 200;

export const LIST_NODE_SELECT = {
  id: true,
  parentId: true,
  name: true,
  isDirectory: true,
  sizeBytes: true,
  mimeType: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ListCursor = {
  isDirectory: boolean;
  name: string;
  id: string;
};

export function encodeListCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeListCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ListCursor;
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed?.name !== "string" ||
      typeof parsed?.isDirectory !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clampListLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : LIST_PAGE_DEFAULT;
  if (!Number.isFinite(n) || n < 1) return LIST_PAGE_DEFAULT;
  return Math.min(n, LIST_PAGE_MAX);
}

/**
 * Cursor predicate for order: isDirectory DESC, name ASC, id ASC.
 * After `(d, n, i)` the next rows are strictly “after” in that order.
 */
function afterListCursor(cursor: ListCursor) {
  return {
    OR: [
      // Still in the directory block, later names
      ...(cursor.isDirectory
        ? [
            {
              isDirectory: true,
              name: { gt: cursor.name },
            },
            {
              isDirectory: true,
              name: cursor.name,
              id: { gt: cursor.id },
            },
            // Cross into files
            { isDirectory: false },
          ]
        : [
            {
              isDirectory: false,
              name: { gt: cursor.name },
            },
            {
              isDirectory: false,
              name: cursor.name,
              id: { gt: cursor.id },
            },
          ]),
    ],
  };
}

export type ListChildrenPage = {
  items: Array<{
    id: string;
    parentId: string | null;
    name: string;
    isDirectory: boolean;
    sizeBytes: bigint;
    mimeType: string;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

/** List immediate children of a folder (or root if parentId is null). */
export async function listChildren(
  ownerId: string,
  parentId: string | null,
  includeDeleted = false
) {
  const rows = await db.fileNode.findMany({
    where: {
      ownerId,
      parentId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    select: LIST_NODE_SELECT,
    orderBy: [{ isDirectory: "desc" }, { name: "asc" }, { id: "asc" }],
  });
  return rows.filter((r) => !isReservedStorageName(r.name));
}

/**
 * Paginated list for owner scope (root or owned folder).
 */
export async function listChildrenPage(
  where: { ownerId?: string; parentId: string | null; deletedAt?: null },
  opts: { limit: number; cursor?: ListCursor | null }
): Promise<ListChildrenPage> {
  const limit = opts.limit;
  const rows = await db.fileNode.findMany({
    where: {
      ...(where.ownerId !== undefined ? { ownerId: where.ownerId } : {}),
      parentId: where.parentId,
      deletedAt: where.deletedAt === undefined ? null : where.deletedAt,
      ...(opts.cursor ? afterListCursor(opts.cursor) : {}),
    },
    select: LIST_NODE_SELECT,
    orderBy: [{ isDirectory: "desc" }, { name: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const filtered = rows.filter((r) => !isReservedStorageName(r.name));
  const hasMore = filtered.length > limit;
  const page = hasMore ? filtered.slice(0, limit) : filtered;
  const last = page[page.length - 1];
  return {
    items: page,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeListCursor({
            isDirectory: last.isDirectory,
            name: last.name,
            id: last.id,
          })
        : null,
  };
}

/**
 * List children of a folder as seen by a viewer (owner OR shared recipient).
 */
export async function listChildrenForViewer(
  ctx: ViewerContext,
  parentId: string | null
) {
  if (ctx.kind === "owner") {
    return listChildren(ctx.userId, parentId);
  }
  if (parentId === null) {
    return [];
  }
  const rows = await db.fileNode.findMany({
    where: { parentId, deletedAt: null },
    select: LIST_NODE_SELECT,
    orderBy: [{ isDirectory: "desc" }, { name: "asc" }, { id: "asc" }],
  });
  return rows.filter((r) => !isReservedStorageName(r.name));
}

export async function listChildrenPageForViewer(
  ctx: ViewerContext,
  parentId: string | null,
  opts: { limit: number; cursor?: ListCursor | null }
): Promise<ListChildrenPage> {
  if (ctx.kind === "owner") {
    return listChildrenPage(
      { ownerId: ctx.userId, parentId, deletedAt: null },
      opts
    );
  }
  if (parentId === null) {
    return { items: [], nextCursor: null, hasMore: false };
  }
  return listChildrenPage({ parentId, deletedAt: null }, opts);
}

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

export async function computeSubtreeSize(
  ownerId: string,
  nodeId: string
): Promise<bigint> {
  const node = await db.fileNode.findUnique({
    where: { id: nodeId },
    select: { isDirectory: true, sizeBytes: true, ownerId: true, deletedAt: true },
  });
  if (!node || node.ownerId !== ownerId) return 0n;
  if (node.deletedAt) return 0n;
  if (!node.isDirectory) return node.sizeBytes;
  let total = 0n;
  const children = await db.fileNode.findMany({
    where: { parentId: nodeId, ownerId, deletedAt: null },
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

export interface PurgeSubtreeOptions {
  retentionCutoff?: Date;
  onPurgedFile?: (sizeBytes: bigint) => void;
}

export async function purgeSubtree(
  ownerId: string,
  nodeId: string,
  storage: { delete: (key: string) => Promise<void> },
  options: PurgeSubtreeOptions = {}
): Promise<void> {
  const { retentionCutoff, onPurgedFile } = options;
  const node = await db.fileNode.findUnique({ where: { id: nodeId } });
  if (!node) return;
  if (node.ownerId !== ownerId) return;

  if (node.isDirectory) {
    const children = await db.fileNode.findMany({
      where: { parentId: nodeId, ownerId },
      select: { id: true, deletedAt: true },
    });
    for (const child of children) {
      if (retentionCutoff) {
        if (child.deletedAt === null || child.deletedAt >= retentionCutoff) {
          continue;
        }
      }
      await purgeSubtree(ownerId, child.id, storage, options);
    }
  } else {
    try {
      await storage.delete(node.storageKey);
    } catch {
      // Best-effort
    }
    onPurgedFile?.(node.sizeBytes);
  }
  await db.fileNode.delete({ where: { id: nodeId } });
}

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

export const DOMA_META_DIR = ".doma";

export function isReservedStorageName(name: string): boolean {
  return name.trim() === DOMA_META_DIR;
}

export function sanitizeName(name: string): string {
  if (isReservedStorageName(name)) return "untitled";

  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 240);
  if (!cleaned || /^_+$/.test(cleaned)) return "untitled";
  return cleaned;
}

export function hasPermission(ctx: ViewerContext, required: Permission): boolean {
  if (ctx.kind === "owner") return true;
  const order: Permission[] = ["view", "upload", "edit"];
  return order.indexOf(ctx.permission) >= order.indexOf(required);
}

export { guessMime, categorize };
