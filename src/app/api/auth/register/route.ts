import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  hashPassword,
  signSession,
  setSessionCookie,
} from "@/lib/auth/session";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { isUsernameTaken } from "@/lib/auth/users";
import { isValidPassword } from "@/lib/auth/password-policy";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const BodySchema = z.object({
  username: z
    .string()
    .min(3, "Минимум 3 символа")
    .max(32, "Максимум 32 символа")
    .regex(/^[a-zA-Z0-9._-]+$/, "Только латиница, цифры, точка, подчёркивание, дефис"),
  displayName: z.string().min(1).max(64).optional(),
  password: z.string().max(200),
}).superRefine((data, ctx) => {
  const r = isValidPassword(data.password);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", path: ["password"], message: r.reason });
  }
});

export async function POST(req: NextRequest) {
  // Rate limit — 5 registrations per minute per IP.
  const ip = getClientIp(req);
  const rl = rateLimit(`register:${ip}`, LIMITS.register.limit, LIMITS.register.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток регистрации. Попробуйте через минуту." },
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  const { username, displayName, password } = parsed.data;

  // Enforce registrationOpen system setting — but only if users already exist.
  // The very first user (the initial admin during setup) is always allowed.
  const userCount = await db.user.count();
  if (userCount > 0) {
    const { getSetting } = await import("@/lib/cloud/settings");
    const registrationOpen = await getSetting("registrationOpen");
    if (!registrationOpen) {
      return NextResponse.json(
        { error: "Регистрация отключена администратором" },
        { status: 403 }
      );
    }
  }

  // Username uniqueness (case-insensitive — SQLite default comparison is case-sensitive).
  if (await isUsernameTaken(username)) {
    return NextResponse.json(
      { error: "Имя пользователя уже занято" },
      { status: 409 }
    );
  }

  // First registered user becomes admin with full quota (configured via
  // the adminQuotaBytes setting, default 3 TB). Subsequent users get the
  // default quota from system settings.
  const isAdmin = userCount === 0;
  const { getSetting } = await import("@/lib/cloud/settings");
  const quotaBytes = isAdmin
    ? await getSetting("adminQuotaBytes")
    : await getSetting("defaultQuotaBytes");

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await db.user.create({
      data: {
        username,
        displayName: displayName ?? username,
        passwordHash,
        role: isAdmin ? "admin" : "user",
        quotaBytes,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation. Two parallel registrations with
    // the same username both pass the `isUsernameTaken` check, but only one
    // can win the INSERT — the other gets P2002. Map to a friendly 409.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Имя пользователя уже занято" },
        { status: 409 }
      );
    }
    throw err;
  }

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
      createdAt: user.createdAt.toISOString(),
    },
    isFirstUser: isAdmin,
  });
}
