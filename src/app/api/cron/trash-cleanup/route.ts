import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getAllSettings } from "@/lib/cloud/settings";
import { purgeSubtree } from "@/lib/cloud/tree";

/**
 * CRON endpoint — purges trash older than trashRetentionDays.
 *
 * Trigger:
 *   - External cron:  curl -X POST http://localhost:3000/api/cron/trash-cleanup \
 *                       -H "X-Cron-Secret: $CRON_SECRET"
 *   - Or systemd timer / docker sidecar / Next.js middleware on schedule.
 *
 * Auth: X-Cron-Secret header must match CRON_SECRET env var. This prevents
 * external attackers from triggering cleanup (which would just delete
 * already-trashed files, but still — don't expose it).
 *
 * If CRON_SECRET is not set, the endpoint refuses to run (so it can't be
 * triggered anonymously in a misconfigured deployment).
 */

export async function POST(req: NextRequest) {
  // Auth check.
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — endpoint disabled" },
      { status: 503 }
    );
  }
  // Reject the .env.example placeholder — it's documented as a default and
  // must be replaced before the cron endpoint is allowed to do anything.
  if (expectedSecret === "replace-me-with-a-random-cron-secret") {
    return NextResponse.json(
      { error: "CRON_SECRET is still the .env.example placeholder — endpoint disabled" },
      { status: 503 }
    );
  }
  const providedSecret = req.headers.get("x-cron-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getAllSettings();
  if (settings.trashRetentionDays === 0) {
    return NextResponse.json({
      ok: true,
      message: "Auto-cleanup disabled (trashRetentionDays = 0)",
      purgedCount: 0,
    });
  }

  const cutoff = new Date(Date.now() - settings.trashRetentionDays * 86400_000);

  // Find all soft-deleted files older than the cutoff.
  // We look for top-level deleted nodes (those without a deleted parent) to
  // avoid double-counting nested items.
  const expired = await db.fileNode.findMany({
    where: {
      deletedAt: { lt: cutoff, not: null },
    },
    select: { id: true, ownerId: true, storageKey: true, isDirectory: true, name: true },
  });

  const storage = await getStorage();
  let purgedFiles = 0;
  let purgedDirs = 0;
  let freedBytes = 0n;

  for (const node of expired) {
    if (node.isDirectory) {
      try {
        await purgeSubtree(node.ownerId, node.id, storage);
        purgedDirs += 1;
      } catch {
        // best-effort
      }
    } else {
      // Get size before deleting for stats.
      try {
        const stat = await storage.stat(node.storageKey);
        freedBytes += BigInt(stat.size);
      } catch {
        // file may already be gone
      }
      try {
        await storage.delete(node.storageKey);
      } catch {
        // best-effort
      }
      await db.fileNode.delete({ where: { id: node.id } }).catch(() => undefined);
      purgedFiles += 1;
    }
  }

  // Recompute usedBytes for affected users.
  const affectedUserIds = [...new Set(expired.map((n) => n.ownerId))];
  for (const userId of affectedUserIds) {
    const usedBytes = await db.fileNode.aggregate({
      where: { ownerId: userId, isDirectory: false, deletedAt: null },
      _sum: { sizeBytes: true },
    });
    await db.user.update({
      where: { id: userId },
      data: { usedBytes: usedBytes._sum.sizeBytes ?? 0n },
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    purgedFiles,
    purgedDirs,
    freedBytes: freedBytes.toString(),
    cutoff: cutoff.toISOString(),
    affectedUsers: affectedUserIds.length,
  });
}

/** GET — same as POST but for cron services that only support GET. */
export async function GET(req: NextRequest) {
  return POST(req);
}
