import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword, verifyPassword, signSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { isValidPassword } from "@/lib/auth/password-policy";
import { z } from "zod";

const Schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().max(200),
}).superRefine((data, ctx) => {
  const r = isValidPassword(data.newPassword);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", path: ["newPassword"], message: r.reason });
  }
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Rate limit — 10 attempts / minute per user + IP. Without this, a hijacked
  // session could brute-force the victim's currentPassword at unlimited speed.
  const ip = getClientIp(req);
  const rl = rateLimit(`pwd:${session.sub}:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте через минуту." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
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

  // ATOMIC password change + tokenVersion bump.
  //
  // Previously these were two separate writes:
  //   1. db.user.update({ passwordHash })
  //   2. invalidateUserSessions(user.id)  // db.user.update({ tokenVersion: increment })
  //
  // If step 2 failed (DB crash, network drop), the password was changed
  // but old sessions remained valid — defeating the security guarantee.
  // Combining both fields into a single Prisma update makes the change
  // atomic at the SQLite row level.
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      tokenVersion: { increment: 1 },
    },
    select: { id: true, username: true, role: true, tokenVersion: true },
  });

  // Re-issue token for THIS session with the new tokenVersion so the user
  // isn't logged out on this device (their other devices will be).
  const newToken = await signSession({
    sub: updated.id,
    username: updated.username,
    role: updated.role as "admin" | "user",
    ver: updated.tokenVersion,
  });
  await setSessionCookie(newToken);

  return NextResponse.json({ ok: true });
}
