import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { listChildren } from "@/lib/cloud/tree";
import { categorize } from "@/lib/cloud/mime";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") ?? null; // null = root
  const trashed = url.searchParams.get("trashed") === "1";

  let items;
  if (trashed) {
    // #13 — Trash shows only TOP-LEVEL deleted items.
    // A "top-level" deleted item is one whose parent is either null OR not deleted.
    // This prevents showing the internal structure of a deleted folder (all its
    // children are implied — they go away when the folder is restored or purged).
    items = await db.fileNode.findMany({
      where: {
        ownerId: session.sub,
        deletedAt: { not: null },
        OR: [
          { parentId: null },
          {
            parent: { deletedAt: null },
          },
        ],
      },
      orderBy: [{ deletedAt: "desc" }],
    });
  } else {
    items = await listChildren(session.sub, parentId);
  }

  return NextResponse.json({
    items: items.map((n) => ({
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
    })),
  });
}
