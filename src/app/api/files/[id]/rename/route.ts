import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { sanitizeName } from "@/lib/cloud/tree";
import { z } from "zod";

const BodySchema = z.object({ name: z.string().min(1).max(240) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверное имя" }, { status: 422 });
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub, deletedAt: null },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const newName = sanitizeName(parsed.data.name);
  // Avoid duplicate names in the same parent.
  const dup = await db.fileNode.findFirst({
    where: {
      ownerId: session.sub,
      parentId: node.parentId,
      name: newName,
      id: { not: id },
      deletedAt: null,
    },
  });
  if (dup) {
    return NextResponse.json({ error: "Имя уже занято" }, { status: 409 });
  }

  await db.fileNode.update({ where: { id }, data: { name: newName } });
  return NextResponse.json({ ok: true, name: newName });
}
