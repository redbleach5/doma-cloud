import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { categorize } from "@/lib/cloud/mime";

/**
 * GET — list nodes (folders AND files) shared with the current user.
 *
 * Each entry includes SharedItem.id (as `id`), the node id (`folderId` kept
 * for backwards-compat with the UI mapping helpers — also as `nodeId`),
 * and file metadata so the browser can render folders and files together.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const shares = await db.sharedItem.findMany({
    where: { recipientId: session.sub },
    include: {
      node: {
        select: {
          id: true,
          name: true,
          deletedAt: true,
          isDirectory: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      owner: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = shares
    .filter((s) => !s.node.deletedAt)
    .map((s) => ({
      id: s.id,
      /** @deprecated Prefer nodeId — kept for existing client mapping. */
      folderId: s.node.id,
      nodeId: s.node.id,
      folderName: s.node.name,
      nodeName: s.node.name,
      ownerDisplayName: s.owner.displayName,
      ownerUsername: s.owner.username,
      permission: s.permission as "view" | "upload" | "edit",
      createdAt: s.createdAt,
      sizeBytes: s.node.sizeBytes.toString(),
      category: categorize(s.node.name, s.node.mimeType),
      mimeType: s.node.mimeType,
      isDirectory: s.node.isDirectory,
      parentId: null,
      deletedAt: null,
      updatedAt: s.node.updatedAt,
      isShared: true,
    }));

  return NextResponse.json({ items });
}
