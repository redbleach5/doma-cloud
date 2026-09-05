import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { recomputeUserUsedBytes } from "@/lib/cloud/tree";

/**
 * POST /api/files/empty-trash — permanently delete every trashed node
 * owned by the authenticated user.
 *
 * "Every trashed node" means every FileNode with deletedAt != null owned
 * by the caller — including "orphan" trashed files inside active folders
 * (which are not surfaced by the trash list endpoint but still consume
 * quota and clutter the DB). This matches the user expectation that
 * "Empty Trash" removes everything that's been deleted, not just the
 * top-level entries visible in the UI.
 *
 * Children are deleted before parents (Prisma onDelete: NoAction on the
 * self-relation would otherwise refuse to delete a parent that still
 * has children). We batch the deletion in dependency order: leaves
 * first, then their parents, etc.
 *
 * Returns the freed byte count and the number of purged top-level
 * entries.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Find every trashed node owned by the caller, ordered so that children
  // come before parents (deepest first). We use `createdAt DESC` as a
  // proxy — but actually the safest approach is to delete leaves first
  // (nodes with no children) and iterate.
  //
  // Simpler approach: fetch all trashed nodes, then delete them one by
  // one in reverse-hierarchy order. SQLite is fast enough for the family-
  // scale trash size this app targets.
  const trashed = await db.fileNode.findMany({
    where: { ownerId: session.sub, deletedAt: { not: null } },
    select: { id: true, isDirectory: true, sizeBytes: true, parentId: true },
  });

  if (trashed.length === 0) {
    const usedBytes = await recomputeUserUsedBytes(session.sub);
    return NextResponse.json({ ok: true, purgedCount: 0, usedBytes: usedBytes.toString() });
  }

  const storage = await getStorage();

  // Build lookup maps once — O(1) per access. The previous `trashed.find()`
  // inside the recursive delete was O(N) per call, making empty-trash O(N²)
  // overall (pathological for tens of thousands of trashed entries).
  const childrenOf = new Map<string | null, string[]>();
  const nodeById = new Map<string, (typeof trashed)[number]>();
  for (const node of trashed) {
    nodeById.set(node.id, node);
    const arr = childrenOf.get(node.parentId) ?? [];
    arr.push(node.id);
    childrenOf.set(node.parentId, arr);
  }

  // Top-level trashed entries = those whose parent is NOT in the trashed
  // set (i.e. parent is null OR parent is not trashed).
  const trashedIds = new Set(trashed.map((n) => n.id));
  const topLevelTrashed = trashed.filter(
    (n) => n.parentId === null || !trashedIds.has(n.parentId)
  );

  // Recursive bottom-up delete. For a leaf: just delete (and remove
  // storage object if it's a file). For a folder: recurse into children
  // first, then delete the folder row.
  const deleteRecursive = async (id: string): Promise<void> => {
    const childIds = childrenOf.get(id) ?? [];
    for (const childId of childIds) {
      await deleteRecursive(childId);
    }
    const node = nodeById.get(id);
    if (node && !node.isDirectory) {
      // Best-effort storage delete — DB row is removed regardless.
      try {
        const full = await db.fileNode.findUnique({
          where: { id },
          select: { storageKey: true },
        });
        if (full) {
          await storage.delete(full.storageKey);
        }
      } catch {
        // ignore — DB row will still be removed
      }
    }
    try {
      await db.fileNode.delete({ where: { id } });
    } catch {
      // Row may already be gone (cascade or duplicate) — ignore.
    }
  };

  for (const top of topLevelTrashed) {
    await deleteRecursive(top.id);
  }

  const usedBytes = await recomputeUserUsedBytes(session.sub);

  return NextResponse.json({
    ok: true,
    purgedCount: topLevelTrashed.length,
    usedBytes: usedBytes.toString(),
  });
}
