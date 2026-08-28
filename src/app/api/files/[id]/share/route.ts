import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth/session";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { z } from "zod";
import { nanoid } from "nanoid";

const BodySchema = z.object({
  password: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
  maxViews: z.number().int().min(1).max(100000).optional(),
  oneTimeUse: z.boolean().optional(),
  label: z.string().max(120).optional(),
});

/**
 * Create or update the single public share link for a file.
 *
 * Family UX: one active link per file. Re-sharing updates settings in place
 * and keeps the same token (bookmarks / already-sent links keep working).
 *
 * Folders are NOT supported here — use `POST /api/files/[id]/share-folder`.
 *
 * Rate-limited (10 creates/min/user) to prevent link-spamming.
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

  const rl = rateLimit(`share-create:${session.sub}`, LIMITS.shareCreate.limit, LIMITS.shareCreate.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много ссылок за минуту. Попробуйте позже." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const node = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub, deletedAt: null },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (node.isDirectory) {
    return NextResponse.json(
      { error: "Папки нельзя расшарить публичной ссылкой — используйте «Поделиться с пользователем» в контекстном меню папки" },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 422 });
  }

  // Explicit empty password clears protection; omit keeps previous hash on update.
  const passwordProvided = Object.prototype.hasOwnProperty.call(parsed.data, "password");
  let passwordHash: string | null | undefined = undefined;
  if (passwordProvided) {
    passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : null;
  }

  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  const maxViews = parsed.data.maxViews ?? null;
  const oneTimeUse = parsed.data.oneTimeUse ?? false;
  const label = parsed.data.label ?? null;

  const existing = await db.share.findFirst({
    where: { nodeId: id, createdBy: session.sub },
    orderBy: { createdAt: "desc" },
  });

  let share;
  let updated = false;

  if (existing) {
    // Keep token; refresh settings. Reset usedCount so new limits apply cleanly.
    // If there were orphan older links (from before one-link-per-file), drop them.
    await db.share.deleteMany({
      where: {
        nodeId: id,
        createdBy: session.sub,
        id: { not: existing.id },
      },
    });

    share = await db.share.update({
      where: { id: existing.id },
      data: {
        label,
        ...(passwordHash !== undefined ? { passwordHash } : {}),
        expiresAt,
        maxViews,
        oneTimeUse,
        usedCount: 0,
      },
    });
    updated = true;
  } else {
    share = await db.share.create({
      data: {
        nodeId: id,
        token: nanoid(24),
        label,
        passwordHash: passwordHash ?? null,
        expiresAt,
        maxViews,
        oneTimeUse,
        createdBy: session.sub,
      },
    });
  }

  return NextResponse.json({
    token: share.token,
    url: `/s/${share.token}`,
    label: share.label,
    expiresAt: share.expiresAt,
    maxViews: share.maxViews,
    hasPassword: !!share.passwordHash,
    oneTimeUse: share.oneTimeUse,
    updated,
  });
}

/**
 * List active link-shares for a file.
 *
 * Enforces file ownership — only the owner can list link-shares for their
 * file. Normally 0–1 shares (one link per file).
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
    select: { id: true },
  });
  if (!node) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const shares = await db.share.findMany({
    where: { nodeId: id, createdBy: session.sub },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    shares: shares.map((s) => ({
      id: s.id,
      token: s.token,
      url: `/s/${s.token}`,
      label: s.label,
      expiresAt: s.expiresAt,
      maxViews: s.maxViews,
      usedCount: s.usedCount,
      hasPassword: !!s.passwordHash,
      oneTimeUse: s.oneTimeUse,
      createdAt: s.createdAt,
    })),
  });
}
