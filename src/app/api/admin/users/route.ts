import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hashPassword } from "@/lib/auth/session";
import { getSetting } from "@/lib/cloud/settings";
import { computeDirectorySize } from "@/lib/cloud/tree";
import { z } from "zod";

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

  // Compute actual used space per user (usedBytes column is eventually-consistent).
  const enriched = await Promise.all(
    users.map(async (u) => {
      const realUsed = await computeDirectorySize(u.id, null);
      return {
        ...u,
        quotaBytes: u.quotaBytes.toString(),
        usedBytes: realUsed.toString(),
        birthday: u.birthday?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      };
    })
  );

  return NextResponse.json({ users: enriched });
}

const CreateSchema = z.object({
  username: z
    .string()
    .min(3, "Минимум 3 символа")
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/, "Только латиница, цифры, точка, подчёркивание, дефис"),
  displayName: z.string().min(1).max(64).optional(),
  password: z.string().min(6, "Минимум 6 символов").max(200),
  role: z.enum(["admin", "user"]).optional(),
  quotaBytes: z.string().optional(), // string-encoded BigInt
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

  // Uniqueness (case-insensitive check)
  const existing =
    (await db.user.findUnique({ where: { username } })) ??
    (await db.user.findFirst({ where: { username: username.toLowerCase() } }));
  if (existing) {
    return NextResponse.json({ error: "Имя пользователя уже занято" }, { status: 409 });
  }

  const finalRole = role ?? "user";
  const finalQuota = quotaBytes
    ? BigInt(quotaBytes)
    : finalRole === "admin"
      ? 3n * 1024n * 1024n * 1024n * 1024n // 3 TB for admins
      : await getSetting("defaultQuotaBytes");

  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: {
      username,
      displayName: displayName?.trim() || username,
      passwordHash,
      role: finalRole,
      quotaBytes: finalQuota,
    },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
    },
  });
}
