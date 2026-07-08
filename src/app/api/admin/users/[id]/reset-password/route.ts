import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hashPassword, invalidateUserSessions } from "@/lib/auth/session";
import { z } from "zod";

const Schema = z.object({
  newPassword: z.string().min(6, "Минимум 6 символов").max(200),
});

/** POST — admin resets a user's password (no current password required). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db.user.update({
    where: { id },
    data: { passwordHash: newHash },
  });
  // Invalidate ALL sessions for this user — they must log in with the new password.
  await invalidateUserSessions(id);

  return NextResponse.json({ ok: true });
}
