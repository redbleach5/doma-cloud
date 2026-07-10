import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStorage } from "@/lib/storage";
import { z } from "zod";

const PatchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  role: z.enum(["admin", "user"]).optional(),
  quotaBytes: z.string().optional(),
  birthday: z.string().datetime().nullable().optional(),
});

/** PATCH — update user properties (quota, role, name, birthday). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
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

  // Safety: don't allow demoting the last admin.
  if (parsed.data.role === "user" && target.role === "admin") {
    const adminCount = await db.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Нельзя понизить последнего администратора" },
        { status: 422 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) update.displayName = parsed.data.displayName.trim();
  if (parsed.data.role !== undefined) update.role = parsed.data.role;
  if (parsed.data.quotaBytes !== undefined) {
    try {
      update.quotaBytes = BigInt(parsed.data.quotaBytes);
    } catch {
      return NextResponse.json({ error: "Неверный размер квоты" }, { status: 422 });
    }
  }
  if (parsed.data.birthday !== undefined) {
    update.birthday = parsed.data.birthday ? new Date(parsed.data.birthday) : null;
  }

  const updated = await db.user.update({ where: { id }, data: update });
  return NextResponse.json({
    user: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      quotaBytes: updated.quotaBytes.toString(),
      birthday: updated.birthday?.toISOString() ?? null,
    },
  });
}

/** DELETE — permanently delete user AND all their files. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  // Safety: don't allow deleting the last admin.
  if (target.role === "admin") {
    const adminCount = await db.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Нельзя удалить последнего администратора" },
        { status: 422 }
      );
    }
  }

  // Safety: don't allow deleting yourself.
  if (id === guard.user.id) {
    return NextResponse.json(
      { error: "Нельзя удалить самого себя" },
      { status: 422 }
    );
  }

  // Purge all files from storage, then delete the user (cascade removes FileNode rows).
  const storage = await getStorage();
  const files = await db.fileNode.findMany({
    where: { ownerId: id, isDirectory: false },
    select: { id: true, storageKey: true },
  });
  for (const file of files) {
    try {
      await storage.delete(file.storageKey);
    } catch {
      // best-effort
    }
  }
  await db.user.delete({ where: { id } });

  return NextResponse.json({ ok: true, purgedFiles: files.length });
}
