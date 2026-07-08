import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword, verifyPassword, invalidateUserSessions, signSession, setSessionCookie } from "@/lib/auth/session";
import { z } from "zod";

const Schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6, "Минимум 6 символов").max(200),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 403 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);

  // Invalidate ALL existing sessions (including this one) by incrementing
  // tokenVersion. Then issue a fresh token for the current session so the
  // user isn't logged out on this device.
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });
  await invalidateUserSessions(user.id);

  // Re-issue token for THIS session with the new tokenVersion.
  const freshUser = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, username: true, role: true, tokenVersion: true },
  });
  if (freshUser) {
    const newToken = await signSession({
      sub: freshUser.id,
      username: freshUser.username,
      role: freshUser.role as "admin" | "user",
      ver: freshUser.tokenVersion,
    });
    await setSessionCookie(newToken);
  }

  return NextResponse.json({ ok: true });
}
