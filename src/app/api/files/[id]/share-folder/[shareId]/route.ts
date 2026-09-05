import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { z } from "zod";

const PermissionSchema = z.enum(["view", "upload", "edit"]);

const BodySchema = z.object({
  permission: PermissionSchema,
});

/**
 * PATCH — change the permission level on an existing share (folder or file).
 * Only the owner can change permissions.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id, shareId } = await params;

  const rl = rateLimit(`share-folder:${session.sub}`, LIMITS.shareCreate.limit, LIMITS.shareCreate.windowMs);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub },
    select: { id: true, isDirectory: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 422 });
  }

  if (!node.isDirectory && parsed.data.permission === "upload") {
    return NextResponse.json(
      { error: "Для файла доступны только права «Просмотр» и «Редактирование»" },
      { status: 422 }
    );
  }

  const share = await db.sharedItem.findUnique({
    where: { id: shareId },
    select: { id: true, nodeId: true, ownerId: true },
  });
  if (!share || share.nodeId !== id || share.ownerId !== session.sub) {
    return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
  }

  await db.sharedItem.update({
    where: { id: shareId },
    data: { permission: parsed.data.permission },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — revoke a share (remove the recipient's access).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id, shareId } = await params;

  const rl = rateLimit(`share-folder:${session.sub}`, LIMITS.shareCreate.limit, LIMITS.shareCreate.windowMs);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub },
    select: { id: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const share = await db.sharedItem.findUnique({
    where: { id: shareId },
    select: { id: true, nodeId: true, ownerId: true },
  });
  if (!share || share.nodeId !== id || share.ownerId !== session.sub) {
    return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
  }

  await db.sharedItem.delete({ where: { id: shareId } });
  return NextResponse.json({ ok: true });
}
