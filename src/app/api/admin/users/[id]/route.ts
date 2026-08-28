import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStorage } from "@/lib/storage";
import { normalizeBirthdayDate } from "@/lib/cloud/birthday";
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

  // Safety: don't allow demoting the last admin. Use an atomic conditional
  // UPDATE — `count() <= 1` is a check-then-act race where two concurrent
  // PATCHes both see count=2 and both demote, leaving zero admins.
  // The conditional WHERE clause runs inside the same UPDATE, so SQLite
  // serialises it and only one of the two concurrent requests succeeds.
  if (parsed.data.role === "user" && target.role === "admin") {
    const result = await db.$executeRaw`
      UPDATE User
      SET role = 'user', updatedAt = ${new Date().toISOString()}
      WHERE id = ${id}
        AND (SELECT COUNT(*) FROM User WHERE role = 'admin') > 1
    `;
    if (result === 0) {
      return NextResponse.json(
        { error: "Нельзя понизить последнего администратора" },
        { status: 422 }
      );
    }
    // Skip the generic update below for the role field — we already did it.
    parsed.data.role = undefined;
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
    update.birthday = parsed.data.birthday
      ? normalizeBirthdayDate(parsed.data.birthday)
      : null;
  }

  const updated = await db.user.update({ where: { id }, data: update });
  return NextResponse.json({
    user: {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      quotaBytes: updated.quotaBytes.toString(),
      usedBytes: updated.usedBytes.toString(),
      birthday: updated.birthday?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
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

  // Safety: don't allow deleting yourself.
  if (id === guard.user.id) {
    return NextResponse.json(
      { error: "Нельзя удалить самого себя" },
      { status: 422 }
    );
  }

  // CRITICAL: collect storage keys BEFORE deleting the user. The FileNode
  // relation has `onDelete: Cascade`, so deleting the user immediately
  // removes all their FileNode rows — and the previous implementation tried
  // to fetch storage keys AFTER the cascade, which always returned `[]` and
  // orphaned every file the user ever owned on disk.
  const storage = await getStorage();
  const files = await db.fileNode.findMany({
    where: { ownerId: id, isDirectory: false },
    select: { id: true, storageKey: true },
  });

  // Safety: don't allow deleting the last admin. Use an atomic pre-check via
  // a conditional DELETE — same race-safe pattern as the PATCH handler above.
  if (target.role === "admin") {
    const preCheck = await db.user.count({ where: { role: "admin" } });
    if (preCheck <= 1) {
      return NextResponse.json(
        { error: "Нельзя удалить последнего администратора" },
        { status: 422 }
      );
    }
    // Race-safe guard: only proceed with delete if there's still >1 admin.
    // The DELETE itself can't easily be conditional on a subquery when it
    // cascades FileNode rows, so we wrap the count+delete in a transaction
    // — SQLite serialises writes, so the second concurrent request will see
    // the count AFTER the first one's commit and bail out.
    try {
      await db.$transaction(async (tx) => {
        const cnt = await tx.user.count({ where: { role: "admin" } });
        if (cnt <= 1) {
          throw new Error("LAST_ADMIN");
        }
        await tx.user.delete({ where: { id } });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "LAST_ADMIN") {
        return NextResponse.json(
          { error: "Нельзя удалить последнего администратора" },
          { status: 422 }
        );
      }
      throw err;
    }
    // User + their FileNode rows are gone (cascade). Now purge storage
    // using the keys we collected BEFORE the cascade.
    for (const file of files) {
      try {
        await storage.delete(file.storageKey);
      } catch {
        // best-effort
      }
    }
    return NextResponse.json({ ok: true, purgedFiles: files.length });
  }

  // Non-admin user — straight delete + storage purge.
  await db.user.delete({ where: { id } });
  for (const file of files) {
    try {
      await storage.delete(file.storageKey);
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({ ok: true, purgedFiles: files.length });
}
