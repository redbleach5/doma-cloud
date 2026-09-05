import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { sanitizeName, resolveFolderAccess, hasPermission } from "@/lib/cloud/tree";
import { randomUUID } from "node:crypto";

/**
 * Create a directory under the given parent.
 *
 * Two access modes:
 *   1. Owner      — parentId belongs to the caller. Default behaviour.
 *   2. Shared     — `?sharedFolderId=<id>` is set. The caller is the
 *                   recipient of a SharedFolder whose root is at or above
 *                   `parentId`. Requires `edit` permission (mkdir is a
 *                   structural change).
 *
 * The new directory is created with `ownerId` = the FOLDER OWNER's id
 * (not the recipient's), so the recipient does NOT own the new node —
 * they can still operate on it via the share, but it counts against the
 * owner's quota.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;
  const sharedFolderId = url.searchParams.get("sharedFolderId");

  // ---- Shared-folder mode ----
  if (sharedFolderId) {
    const share = await db.sharedItem.findUnique({
      where: { id: sharedFolderId },
      select: {
        id: true,
        nodeId: true,
        recipientId: true,
        ownerId: true,
        permission: true,
        node: { select: { deletedAt: true, isDirectory: true } },
      },
    });
    if (!share || share.recipientId !== session.sub) {
      return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
    }
    if (share.node.deletedAt || !share.node.isDirectory) {
      return NextResponse.json({ error: "Папка больше не доступна" }, { status: 410 });
    }
    if (!hasPermission(
      { kind: "shared", userId: session.sub, sharedFolderId: share.id, rootFolderId: share.nodeId, permission: share.permission as "view" | "upload" | "edit" },
      "edit"
    )) {
      return NextResponse.json(
        { error: "Недостаточно прав — нужна permission 'edit'" },
        { status: 403 }
      );
    }

    // Determine the effective parent: if parentId is null, use the share root;
    // otherwise verify parentId is inside the shared subtree.
    let effectiveParentId: string;
    if (parentId === null) {
      effectiveParentId = share.nodeId;
    } else {
      const ctx = await resolveFolderAccess(session.sub, parentId);
      if (!ctx || ctx.kind !== "shared" || ctx.rootFolderId !== share.nodeId) {
        return NextResponse.json({ error: "Папка вне области доступа" }, { status: 403 });
      }
      effectiveParentId = parentId;
    }

    let body: { name?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Неверный JSON" }, { status: 400 });
    }

    const name = sanitizeName(body.name ?? "");
    if (!name) {
      return NextResponse.json({ error: "Имя не может быть пустым" }, { status: 422 });
    }

    // Reject duplicate names within the same folder.
    const existing = await db.fileNode.findFirst({
      where: { parentId: effectiveParentId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Уже существует" }, { status: 409 });
    }

    // Create the directory owned by the share owner (not the recipient).
    const node = await db.fileNode.create({
      data: {
        id: randomUUID(),
        ownerId: share.ownerId,
        parentId: effectiveParentId,
        name,
        isDirectory: true,
        storageKey: `${share.ownerId}/dir-${randomUUID()}`,
        mimeType: "inode/directory",
      },
    });

    return NextResponse.json({ id: node.id, name: node.name });
  }

  // ---- Owner mode ----
  if (parentId) {
    const parent = await db.fileNode.findFirst({
      where: {
        id: parentId,
        ownerId: session.sub,
        isDirectory: true,
        deletedAt: null,
      },
    });
    if (!parent) {
      return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
    }
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Неверный JSON" }, { status: 400 });
  }

  const name = sanitizeName(body.name ?? "");
  if (!name) {
    return NextResponse.json({ error: "Имя не может быть пустым" }, { status: 422 });
  }

  // Reject duplicate names within the same folder.
  const existing = await db.fileNode.findFirst({
    where: { ownerId: session.sub, parentId, name, deletedAt: null },
  });
  if (existing) {
    return NextResponse.json({ error: "Уже существует" }, { status: 409 });
  }

  const node = await db.fileNode.create({
    data: {
      id: randomUUID(),
      ownerId: session.sub,
      parentId,
      name,
      isDirectory: true,
      storageKey: `${session.sub}/dir-${randomUUID()}`,
      mimeType: "inode/directory",
    },
  });

  return NextResponse.json({ id: node.id, name: node.name });
}
