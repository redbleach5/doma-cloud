import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { z } from "zod";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  // Read the cached `usedBytes` — maintained incrementally by upload/delete.
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
      usedBytes: user.usedBytes.toString(),
      birthday: user.birthday?.toISOString() ?? null,
      themePreference: user.themePreference,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
  });
}

const PatchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  birthday: z.string().datetime().nullable().optional(),
  themePreference: z.enum(["light", "dark", "system"]).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) {
    update.displayName = parsed.data.displayName.trim();
  }
  if (parsed.data.birthday !== undefined) {
    update.birthday = parsed.data.birthday ? new Date(parsed.data.birthday) : null;
  }
  if (parsed.data.themePreference !== undefined) {
    update.themePreference = parsed.data.themePreference;
  }

  const user = await db.user.update({
    where: { id: session.sub },
    data: update,
  });

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      birthday: user.birthday?.toISOString() ?? null,
      themePreference: user.themePreference,
    },
  });
}
