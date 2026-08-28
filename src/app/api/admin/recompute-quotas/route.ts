import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { recomputeUserUsedBytes } from "@/lib/cloud/tree";

/**
 * POST /api/admin/recompute-quotas
 *
 * Recomputes `user.usedBytes` for every user from scratch (single SQL
 * aggregate per user) and persists the result. Use this when you suspect
 * the cached counter has drifted from reality — e.g. after a crash during
 * upload, a manual DB edit, or after applying the migration from the
 * old "compute on every read" model.
 *
 * Returns the recomputed totals per user so the admin UI can show the diff.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const users = await db.user.findMany({
    select: { id: true, username: true, usedBytes: true },
    orderBy: { createdAt: "asc" },
  });

  const results = await Promise.all(
    users.map(async (u) => {
      const before = u.usedBytes;
      const after = await recomputeUserUsedBytes(u.id);
      return {
        id: u.id,
        username: u.username,
        before: before.toString(),
        after: after.toString(),
        drift: (after - before).toString(),
      };
    })
  );

  return NextResponse.json({
    ok: true,
    recomputed: results.length,
    users: results,
  });
}
