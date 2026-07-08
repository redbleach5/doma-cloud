import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { sanitizeName } from "@/lib/cloud/tree";
import { randomUUID } from "node:crypto";

/** Create a directory under the given parent. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;

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
