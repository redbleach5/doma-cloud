import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { LIST_NODE_SELECT } from "@/lib/cloud/tree";
import { categorize } from "@/lib/cloud/mime";

/**
 * Pick one random image from the caller's library (not trash).
 * Prefers photos older than 30 days when any exist — “memory” feel.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const baseWhere = {
    ownerId: session.sub,
    deletedAt: null,
    isDirectory: false,
    mimeType: { startsWith: "image/" },
  } as const;

  const oldCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const oldCount = await db.fileNode.count({
    where: { ...baseWhere, createdAt: { lt: oldCutoff } },
  });

  const where =
    oldCount > 0
      ? { ...baseWhere, createdAt: { lt: oldCutoff } }
      : baseWhere;

  const total = oldCount > 0 ? oldCount : await db.fileNode.count({ where: baseWhere });
  if (total === 0) {
    return NextResponse.json({ item: null });
  }

  const skip = Math.floor(Math.random() * total);
  const node = await db.fileNode.findFirst({
    where,
    select: LIST_NODE_SELECT,
    orderBy: { id: "asc" },
    skip,
  });

  if (!node) {
    return NextResponse.json({ item: null });
  }

  return NextResponse.json({
    item: {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      isDirectory: node.isDirectory,
      sizeBytes: node.sizeBytes.toString(),
      mimeType: node.mimeType,
      category: categorize(node.name, node.mimeType),
      deletedAt: node.deletedAt,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    },
  });
}
