import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getLocalStorageRoot } from "@/lib/storage";
import { promises as fs } from "node:fs";

/** GET — system-wide statistics for the admin dashboard. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  // Aggregate user stats
  const users = await db.user.findMany({
    select: {
      id: true,
      role: true,
      quotaBytes: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  const totalQuota = users.reduce((sum, u) => sum + u.quotaBytes, 0n);

  // Aggregate file stats
  const fileAgg = await db.fileNode.aggregate({
    where: { isDirectory: false, deletedAt: null },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });

  const trashAgg = await db.fileNode.aggregate({
    where: { isDirectory: false, deletedAt: { not: null } },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });

  const sharesCount = await db.share.count();

  // Disk space (local storage only)
  let diskInfo: { total?: number; free?: number; used?: number } = {};
  try {
    const root = await getLocalStorageRoot();
    const stat = await fs.statfs(root);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    diskInfo = { total, free, used: total - free };
  } catch {
    // statfs not available
  }

  return NextResponse.json({
    users: {
      total: users.length,
      admins: users.filter((u) => u.role === "admin").length,
      active: users.filter((u) => u.lastLoginAt).length,
      neverLoggedIn: users.filter((u) => !u.lastLoginAt).length,
    },
    storage: {
      totalQuotaBytes: totalQuota.toString(),
      usedBytes: (fileAgg._sum.sizeBytes ?? 0n).toString(),
      trashBytes: (trashAgg._sum.sizeBytes ?? 0n).toString(),
      fileCount: fileAgg._count._all,
      trashCount: trashAgg._count._all,
      sharesCount,
    },
    disk: {
      totalBytes: diskInfo.total,
      freeBytes: diskInfo.free,
      usedBytes: diskInfo.used,
    },
    perUser: users.map((u) => ({
      id: u.id,
      role: u.role,
      quotaBytes: u.quotaBytes.toString(),
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
  });
}
