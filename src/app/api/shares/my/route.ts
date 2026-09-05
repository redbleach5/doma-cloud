import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/**
 * GET — list nodes the current user has shared with other users.
 * Used by «Мои общие».
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const shares = await db.sharedItem.findMany({
    where: { ownerId: session.sub },
    include: {
      node: {
        select: {
          id: true,
          name: true,
          deletedAt: true,
          isDirectory: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
      recipient: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = shares
    .filter((s) => !s.node.deletedAt)
    .map((s) => ({
      id: s.id,
      folderId: s.node.id,
      nodeId: s.node.id,
      folderName: s.node.name,
      nodeName: s.node.name,
      isDirectory: s.node.isDirectory,
      mimeType: s.node.mimeType,
      sizeBytes: s.node.sizeBytes.toString(),
      recipientDisplayName: s.recipient.displayName,
      recipientUsername: s.recipient.username,
      permission: s.permission as "view" | "upload" | "edit",
      createdAt: s.createdAt,
    }));

  return NextResponse.json({ items });
}
