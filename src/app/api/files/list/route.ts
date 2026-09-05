import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  listChildrenPage,
  listChildrenPageForViewer,
  resolveFolderAccess,
  isReservedStorageName,
  clampListLimit,
  decodeListCursor,
  LIST_NODE_SELECT,
  type Permission,
} from "@/lib/cloud/tree";
import { categorize } from "@/lib/cloud/mime";

/**
 * List files in a folder.
 *
 * Query params:
 *   parentId        — folder id (null/missing = root, owner-only)
 *   trashed=1       — list top-level trashed items (owner-only)
 *   sharedFolderId  — id of a SharedFolder record
 *   limit           — page size (default 100, max 200)
 *   cursor          — opaque cursor from previous page's `nextCursor`
 *
 * Response: `{ items, nextCursor, hasMore }`
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") ?? null;
  const trashed = url.searchParams.get("trashed") === "1";
  const sharedFolderId = url.searchParams.get("sharedFolderId");
  const limit = clampListLimit(url.searchParams.get("limit"));
  const cursor = decodeListCursor(url.searchParams.get("cursor"));

  // ---- Trash view (owner-only), ordered by deletedAt DESC ----
  if (trashed) {
    const trashBase = {
      ownerId: session.sub,
      deletedAt: { not: null } as const,
      OR: [{ parentId: null }, { parent: { deletedAt: null } }],
    };

    let afterTrash: { deletedAt: Date; id: string } | null = null;
    if (cursor) {
      const pivot = await db.fileNode.findUnique({
        where: { id: cursor.id },
        select: { id: true, deletedAt: true },
      });
      if (pivot?.deletedAt) afterTrash = { id: pivot.id, deletedAt: pivot.deletedAt };
    }

    const items = await db.fileNode.findMany({
      where: {
        ...trashBase,
        ...(afterTrash
          ? {
              AND: [
                {
                  OR: [
                    { deletedAt: { lt: afterTrash.deletedAt } },
                    { deletedAt: afterTrash.deletedAt, id: { lt: afterTrash.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: LIST_NODE_SELECT,
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return NextResponse.json({
      items: page.map((n) => mapItem(n)),
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                isDirectory: last.isDirectory,
                name: last.name,
                id: last.id,
              }),
              "utf8"
            ).toString("base64url")
          : null,
    });
  }

  // ---- Shared-folder view ----
  if (sharedFolderId) {
    const share = await db.sharedItem.findUnique({
      where: { id: sharedFolderId },
      select: {
        id: true,
        nodeId: true,
        recipientId: true,
        ownerId: true,
        permission: true,
        node: { select: { name: true, deletedAt: true, isDirectory: true } },
      },
    });
    if (!share || share.recipientId !== session.sub) {
      return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
    }
    if (share.node.deletedAt || !share.node.isDirectory) {
      return NextResponse.json({ error: "Папка больше не доступна" }, { status: 410 });
    }

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

    const page = await listChildrenPage(
      { parentId: effectiveParentId, deletedAt: null },
      { limit, cursor }
    );

    return NextResponse.json({
      items: page.items
        .filter((n) => !isReservedStorageName(n.name))
        .map((n) => ({
          ...mapItem(n),
          isShared: true,
          permission: share.permission as Permission,
        })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  // ---- Owner view (default) ----
  if (parentId !== null) {
    const ctx = await resolveFolderAccess(session.sub, parentId);
    if (!ctx) {
      return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
    }
    const page = await listChildrenPageForViewer(ctx, parentId, { limit, cursor });
    const isShared = ctx.kind === "shared";
    const permission = ctx.kind === "shared" ? ctx.permission : undefined;
    return NextResponse.json({
      items: page.items.map((n) => ({
        ...mapItem(n),
        isShared,
        permission,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  const page = await listChildrenPage(
    { ownerId: session.sub, parentId: null, deletedAt: null },
    { limit, cursor }
  );
  return NextResponse.json({
    items: page.items.map((n) => mapItem(n)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}

function mapItem(n: {
  id: string;
  parentId: string | null;
  name: string;
  isDirectory: boolean;
  sizeBytes: bigint;
  mimeType: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: n.id,
    parentId: n.parentId,
    name: n.name,
    isDirectory: n.isDirectory,
    sizeBytes: n.sizeBytes.toString(),
    mimeType: n.mimeType,
    category: categorize(n.name, n.mimeType),
    deletedAt: n.deletedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}
