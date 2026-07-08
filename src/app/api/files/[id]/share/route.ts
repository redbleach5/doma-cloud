import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/session";
import { z } from "zod";
import { nanoid } from "nanoid";

const BodySchema = z.object({
  password: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
  maxViews: z.number().int().min(1).max(100000).optional(),
  oneTimeUse: z.boolean().optional(),
});

/** Create a share link for a file. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub, deletedAt: null },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (node.isDirectory) {
    return NextResponse.json(
      { error: "Папки пока нельзя расшарить — только файлы" },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 422 });
  }

  let passwordHash: string | null = null;
  if (parsed.data.password) {
    passwordHash = await hashPassword(parsed.data.password);
  }

  const token = nanoid(24);
  const share = await db.share.create({
    data: {
      fileId: id,
      token,
      passwordHash,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      maxViews: parsed.data.maxViews ?? null,
      oneTimeUse: parsed.data.oneTimeUse ?? false,
      createdBy: session.sub,
    },
  });

  return NextResponse.json({
    token: share.token,
    url: `/s/${share.token}`,
    expiresAt: share.expiresAt,
    maxViews: share.maxViews,
    hasPassword: !!passwordHash,
  });
}

/** List active shares for a file. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const shares = await db.share.findMany({
    where: { fileId: id, createdBy: session.sub },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    shares: shares.map((s) => ({
      id: s.id,
      token: s.token,
      url: `/s/${s.token}`,
      expiresAt: s.expiresAt,
      maxViews: s.maxViews,
      usedCount: s.usedCount,
      hasPassword: !!s.passwordHash,
      createdAt: s.createdAt,
    })),
  });
}
