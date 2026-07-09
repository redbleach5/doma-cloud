import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { purgeSubtree, computeSubtreeSize, recomputeUserUsedBytes } from "@/lib/cloud/tree";

/**
 * DELETE  — soft delete (move to trash). ?hard=1 to permanently delete.
 * PATCH   — restore from trash.
 *
 * Trash semantics (#1, #12, #13):
 *   - When a folder is soft-deleted, all descendants get the SAME deletedAt
 *     timestamp as the folder. This lets us distinguish "deleted as part of
 *     parent deletion" from "deleted independently".
 *   - When restoring a folder, only restore descendants that share the same
 *     deletedAt (i.e. were caught in the same deletion). Children deleted
 *     independently (different deletedAt) stay in trash.
 *   - When restoring a FILE whose parent is still deleted, move it to root
 *     (parentId = null) so it's reachable in the UI — no ghost files.
 */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (hard) {
    const storage = getStorage();
    await purgeSubtree(session.sub, id, storage);
    // Hard delete purges bytes that were already soft-deleted, so the
    // `usedBytes` counter (which excludes soft-deleted files) doesn't
    // change. But hard-deleting a NON-trashed node (e.g. via admin) would
    // shift the counter — recompute from scratch to be safe.
    const usedBytes = await recomputeUserUsedBytes(session.sub);
    return NextResponse.json({ ok: true, usedBytes: usedBytes.toString() });
  }

  // Soft delete — mark this node AND all descendants with the SAME timestamp.
  // This is critical for #12: when restoring, we only restore descendants
  // that share this exact timestamp (i.e. were deleted as part of THIS
  // folder deletion, not independently before it).
  const deletedAt = new Date();
  // Compute the size of the subtree being soft-deleted BEFORE the deletion
  // so we can decrement the cached counter incrementally.
  const subtreeSize = await computeSubtreeSize(session.sub, id);
  await db.fileNode.update({
    where: { id },
    data: { deletedAt, deletedBy: session.sub },
  });
  await markDescendantsDeleted(id, session.sub, deletedAt);

  // Decrement the cached counter by the subtree size. O(1) instead of
  // O(N) full-tree traversal.
  await db.user.update({
    where: { id: session.sub },
    data: { usedBytes: { decrement: subtreeSize } },
  });
  // Refresh user row to get the new counter value (cheaper than re-querying).
  const refreshed = await db.user.findUnique({
    where: { id: session.sub },
    select: { usedBytes: true },
  });
  const usedBytes = refreshed?.usedBytes ?? 0n;

  return NextResponse.json({ ok: true, usedBytes: usedBytes.toString() });
}

/**
 * Recursively mark all descendants as deleted with the SAME timestamp.
 * This preserves "were they deleted with the parent or independently?".
 */
async function markDescendantsDeleted(nodeId: string, userId: string, deletedAt: Date) {
  // Only mark NON-deleted descendants. Children that were already in the
  // trash (independently of this folder) must keep their original deletedAt
  // so they stay in trash when this folder is restored.
  const children = await db.fileNode.findMany({
    where: { parentId: nodeId, deletedAt: null },
    select: { id: true },
  });
  for (const child of children) {
    await db.fileNode.update({
      where: { id: child.id },
      data: { deletedAt, deletedBy: userId },
    });
    await markDescendantsDeleted(child.id, userId, deletedAt);
  }
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub, deletedAt: { not: null } },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено в корзине" }, { status: 404 });
  }

  // #1 — Ghost file prevention: if restoring a file whose PARENT is still
  // deleted, move it to root (parentId = null) so it's reachable in the UI.
  // Otherwise it would be an orphan — exists in DB and on disk, counts
  // against quota, but invisible in the file browser.
  let newParentId = node.parentId;
  if (node.parentId) {
    const parent = await db.fileNode.findUnique({
      where: { id: node.parentId },
      select: { deletedAt: true },
    });
    if (parent?.deletedAt) {
      // Parent is still in trash — move this node to root.
      newParentId = null;
    }
  }

  await db.fileNode.update({
    where: { id },
    data: { deletedAt: null, deletedBy: null, parentId: newParentId },
  });

  // #12 — If restoring a FOLDER, only restore descendants that were deleted
  // at the SAME time (same deletedAt). Children deleted independently
  // (different deletedAt) stay in trash.
  if (node.isDirectory) {
    await restoreSameTimestampDescendants(id, node.deletedAt!);
  }

  // Restore semantics are subtle (partial subtree restoration based on
  // matching deletedAt), so an incremental delta is hard to compute
  // correctly. Use a single SQL aggregate as a fallback — still much
  // cheaper than the old recursive computeDirectorySize(null).
  const usedBytes = await recomputeUserUsedBytes(session.sub);

  return NextResponse.json({
    ok: true,
    usedBytes: usedBytes.toString(),
    movedToRoot: newParentId === null && node.parentId !== null,
  });
}

/**
 * Recursively restore descendants that share the same deletedAt timestamp
 * as the parent. Children with a DIFFERENT deletedAt were deleted
 * independently and stay in trash.
 */
async function restoreSameTimestampDescendants(nodeId: string, parentDeletedAt: Date) {
  const children = await db.fileNode.findMany({
    where: { parentId: nodeId, deletedAt: { not: null } },
    select: { id: true, deletedAt: true, isDirectory: true },
  });
  for (const child of children) {
    // Only restore if deleted at the exact same time as the parent.
    if (child.deletedAt && child.deletedAt.getTime() === parentDeletedAt.getTime()) {
      await db.fileNode.update({
        where: { id: child.id },
        data: { deletedAt: null, deletedBy: null },
      });
      if (child.isDirectory) {
        await restoreSameTimestampDescendants(child.id, parentDeletedAt);
      }
    }
  }
}
