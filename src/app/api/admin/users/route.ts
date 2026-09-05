import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hashPassword } from "@/lib/auth/session";
import { getSetting } from "@/lib/cloud/settings";
import { isUsernameTaken } from "@/lib/auth/users";
import { isValidPassword } from "@/lib/auth/password-policy";
import { z } from "zod";
import { Prisma } from "@prisma/client";

export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      quotaBytes: true,
      usedBytes: true,
      birthday: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  // Read the cached `usedBytes` for each user — maintained incrementally by
  // the upload/delete/restore routes. Avoids an O(N×M) tree traversal per
  // admin-users list call. If you suspect drift, hit POST
  // /api/admin/recompute-quotas to recompute from scratch.
  const enriched = users.map((u) => ({
    ...u,
    quotaBytes: u.quotaBytes.toString(),
    usedBytes: u.usedBytes.toString(),
    birthday: u.birthday?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ users: enriched });
}

const CreateSchema = z.object({
  username: z
    .string()
    .min(3, "Минимум 3 символа")
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, "Только латиница, цифры, точка, подчёркивание, дефис"),
  displayName: z.string().min(1).max(64).optional(),
  password: z.string().max(200),
  role: z.enum(["admin", "user"]).optional(),
  quotaBytes: z.string().optional(), // string-encoded BigInt
}).superRefine((data, ctx) => {
  const r = isValidPassword(data.password);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", path: ["password"], message: r.reason });
  }
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  const { username, displayName, password, role, quotaBytes } = parsed.data;

  if (await isUsernameTaken(username)) {
    return NextResponse.json({ error: "Имя пользователя уже занято" }, { status: 409 });
  }

  const finalRole = role ?? "user";
  const finalQuota = quotaBytes
    ? BigInt(quotaBytes)
    : finalRole === "admin"
      ? await getSetting("adminQuotaBytes")
      : await getSetting("defaultQuotaBytes");

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await db.user.create({
      data: {
        username,
        displayName: displayName?.trim() || username,
        passwordHash,
        role: finalRole,
        quotaBytes: finalQuota,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Имя пользователя уже занято" },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
      usedBytes: user.usedBytes.toString(),
      birthday: user.birthday?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
  });
}
