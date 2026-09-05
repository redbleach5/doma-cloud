import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import {
  purgeSubtree,
  computeSubtreeSize,
  recomputeUserUsedBytes,
  resolveNodeAccess,
  hasPermission,
} from "@/lib/cloud/tree";

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
 *
 * Shared-folder support:
 *   - Recipients with `edit` permission can trash/restore nodes INSIDE a
 *     shared subtree (but NOT the shared root itself — only the owner can).
 *   - Hard delete is always owner-only — recipients never physically
 *     destroy data.
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

  // Hard delete is owner-only — never let a recipient purge.
  if (hard) {
    const node = await db.fileNode.findFirst({
      where: { id, ownerId: session.sub },
      select: { id: true },
    });
    if (!node) {
      return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    }
    const storage = await getStorage();
    await purgeSubtree(session.sub, id, storage);
    const usedBytes = await recomputeUserUsedBytes(session.sub);
    return NextResponse.json({ ok: true, usedBytes: usedBytes.toString() });
  }

  // Soft delete — owner OR shared-with-edit.
  const access = await resolveNodeAccess(session.sub, id);
  if (!access) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  if (access.ctx.kind === "shared") {
    // Recipient — must have `edit` permission.
    if (!hasPermission(access.ctx, "edit")) {
      return NextResponse.json(
        { error: "Недостаточно прав — нужна permission 'edit'" },
        { status: 403 }
      );
    }
    // Folder share root: owner-only. Directly shared files may be trashed.
    if (
      access.node.id === access.ctx.rootFolderId &&
      access.node.isDirectory
    ) {
      return NextResponse.json(
        { error: "Нельзя удалить корень расшаренной папки — это может только владелец" },
        { status: 403 }
      );
    }
  }

  // Soft delete — mark this node AND all descendants with the SAME timestamp.
  const deletedAt = new Date();
  const ownerId = access.node.ownerId;
  const subtreeSize = await computeSubtreeSize(ownerId, id);
  const marked = await db.fileNode.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt, deletedBy: session.sub },
  });
  if (marked.count === 0) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  await markDescendantsDeleted(id, ownerId, deletedAt, session.sub);

  // Decrement the OWNER's usedBytes (the file belongs to them).
  await db.user.update({
    where: { id: ownerId },
    data: { usedBytes: { decrement: subtreeSize } },
  });
  const refreshed = await db.user.findUnique({
    where: { id: ownerId },
    select: { usedBytes: true },
  });

  // If the caller is the recipient (not the owner), the response's
  // `usedBytes` field is the OWNER's usedBytes — but the recipient's
  // own usedBytes doesn't change. The UI ignores it for shared views.
  return NextResponse.json({
    ok: true,
    usedBytes: (refreshed?.usedBytes ?? 0n).toString(),
  });
}

/**
 * Recursively mark all descendants as deleted with the SAME timestamp.
 * This preserves "were they deleted with the parent or independently?".
 */
async function markDescendantsDeleted(
  nodeId: string,
  ownerId: string,
  deletedAt: Date,
  deletedBy: string
) {
  const children = await db.fileNode.findMany({
    where: { parentId: nodeId, deletedAt: null },
    select: { id: true },
  });
  for (const child of children) {
    await db.fileNode.update({
      where: { id: child.id },
      data: { deletedAt, deletedBy },
    });
    await markDescendantsDeleted(child.id, ownerId, deletedAt, deletedBy);
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

  // Restore — owner OR shared-with-edit (for nodes inside a shared subtree).
  // The previous check required `ownerId: session.sub` directly; now we use
  // resolveNodeAccess so shared recipients can restore their own accidental
  // deletes inside a shared folder.
  const node = await db.fileNode.findUnique({
    where: { id },
    select: { id: true, ownerId: true, parentId: true, isDirectory: true, deletedAt: true },
  });
  if (!node || !node.deletedAt) {
    return NextResponse.json({ error: "Не найдено в корзине" }, { status: 404 });
  }

  // Authorization: owner OR shared-with-edit.
  // Direct SharedItem on this node matters for shared *files* (ACL root =
  // the file itself). Parent walk covers nodes inside a shared folder.
  let authorized = false;
  if (node.ownerId === session.sub) {
    authorized = true;
  } else {
    const direct = await db.sharedItem.findFirst({
      where: { nodeId: node.id, recipientId: session.sub },
      select: { permission: true },
    });
    if (direct?.permission === "edit") {
      authorized = true;
    } else {
      let cursor: string | null = node.parentId;
      if (node.isDirectory) cursor = node.id;
      while (cursor !== null) {
        const share = await db.sharedItem.findFirst({
          where: { nodeId: cursor, recipientId: session.sub },
          select: { permission: true, nodeId: true },
        });
        if (share) {
          if (share.permission === "edit") authorized = true;
          break;
        }
        const parent: { parentId: string | null } | null = await db.fileNode.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = parent?.parentId ?? null;
      }
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  // #1 — Ghost file prevention: if restoring a file whose PARENT is still
  // deleted, move it to root (parentId = null) so it's reachable in the UI.
  let newParentId = node.parentId;
  if (node.parentId) {
    const parent = await db.fileNode.findUnique({
      where: { id: node.parentId },
      select: { deletedAt: true },
    });
    if (parent?.deletedAt) {
      newParentId = null;
    }
  }

  await db.fileNode.update({
    where: { id },
    data: { deletedAt: null, deletedBy: null, parentId: newParentId },
  });

  if (node.isDirectory) {
    await restoreSameTimestampDescendants(id, node.deletedAt);
  }

  // Recompute owner's usedBytes — restore semantics are subtle (partial
  // subtree restoration based on matching deletedAt), so an incremental
  // delta is hard to compute correctly.
  const usedBytes = await recomputeUserUsedBytes(node.ownerId);

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
