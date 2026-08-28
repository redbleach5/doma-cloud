import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { hashPassword } from "@/lib/auth/session";
import { isValidPassword } from "@/lib/auth/password-policy";
import { z } from "zod";

const Schema = z.object({
  newPassword: z.string().max(200),
}).superRefine((data, ctx) => {
  const r = isValidPassword(data.newPassword);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", path: ["newPassword"], message: r.reason });
  }
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
  // ATOMIC password change + tokenVersion bump (see profile/password/route.ts
  // for the full rationale). Single Prisma update — no microsecond window
  // where old sessions are still valid against the new password.
  await db.user.update({
    where: { id },
    data: {
      passwordHash: newHash,
      tokenVersion: { increment: 1 },
    },
  });

  return NextResponse.json({ ok: true });
}
