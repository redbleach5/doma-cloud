import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { findUserByUsername } from "@/lib/auth/users";
import { z } from "zod";

const PermissionSchema = z.enum(["view", "upload", "edit"]);

const BodySchema = z.object({
  recipientUsername: z.string().min(1).max(120),
  permission: PermissionSchema,
});

/**
 * POST — share a folder OR file with another user account.
 *
 * Re-sharing the same node with the same recipient updates the permission
 * in place (upsert on [nodeId, recipientId]).
 *
 * For files, `upload` permission is rejected (use view/edit).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const rl = rateLimit(`share-folder:${session.sub}`, LIMITS.shareCreate.limit, LIMITS.shareCreate.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много операций. Попробуйте позже." },
      { status: 429 }
    );
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub, deletedAt: null },
    select: { id: true, isDirectory: true, name: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 422 });
  }

  const permission = parsed.data.permission;
  if (!node.isDirectory && permission === "upload") {
    return NextResponse.json(
      { error: "Для файла доступны только права «Просмотр» и «Редактирование»" },
      { status: 422 }
    );
  }

  const recipient = await findUserByUsername(parsed.data.recipientUsername);
  if (!recipient) {
    return NextResponse.json({ error: "Получатель не найден" }, { status: 404 });
  }
  if (recipient.id === session.sub) {
    return NextResponse.json(
      { error: "Нельзя поделиться с самим собой" },
      { status: 422 }
    );
  }

  const share = await db.sharedItem.upsert({
    where: {
      nodeId_recipientId: {
        nodeId: node.id,
        recipientId: recipient.id,
      },
    },
    update: { permission },
    create: {
      nodeId: node.id,
      ownerId: session.sub,
      recipientId: recipient.id,
      permission,
    },
    select: {
      id: true,
      permission: true,
      recipient: { select: { username: true, displayName: true } },
    },
  });

  return NextResponse.json({
    id: share.id,
    permission: share.permission,
    recipientUsername: share.recipient.username,
    recipientDisplayName: share.recipient.displayName,
    updated: true,
  });
}

/**
 * GET — list all users the caller has shared this node with.
 * Owner-only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub },
    select: { id: true, isDirectory: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const shares = await db.sharedItem.findMany({
    where: { nodeId: id, ownerId: session.sub },
    include: {
      recipient: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    shares: shares.map((s) => ({
      id: s.id,
      recipientId: s.recipient.id,
      recipientUsername: s.recipient.username,
      recipientDisplayName: s.recipient.displayName,
      permission: s.permission as "view" | "upload" | "edit",
      createdAt: s.createdAt,
    })),
  });
}
