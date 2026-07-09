import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signSession, setSessionCookie, verifyPassword } from "@/lib/auth/session";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { z } from "zod";

const BodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

// Pre-computed argon2id hash of a random string, used to keep login timing
// roughly constant when the username doesn't exist. Without this, an
// attacker could enumerate accounts by response time (existing users run
// argon2, missing users return immediately). verifyPassword will always
// return false for the real password, but the ~80ms of argon2 work
// happens regardless.
const DUMMY_ARGON2_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function POST(req: NextRequest) {
  // Rate limit — 10 login attempts per minute per IP.
  const ip = getClientIp(req);
  const rl = rateLimit(`login:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте через минуту." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Неверный JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные данные" }, { status: 422 });
  }

  const { username, password } = parsed.data;

  // SQLite doesn't support `mode: insensitive` — try exact then lowercase.
  const user =
    (await db.user.findUnique({ where: { username } })) ??
    (await db.user.findFirst({ where: { username: username.toLowerCase() } }));
  if (!user) {
    // Constant-time-ish: still run argon2 to avoid user enumeration by timing.
    await verifyPassword(password, DUMMY_ARGON2_HASH);
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  // Update lastLoginAt — used by admin stats ("active users") and security
  // audit. Fire-and-forget; failure here shouldn't block login.
  db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => undefined);

  const token = await signSession({
    sub: user.id,
    username: user.username,
    role: user.role as "admin" | "user",
    ver: user.tokenVersion,
  });
  await setSessionCookie(token);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
      usedBytes: user.usedBytes.toString(),
    },
  });
}
