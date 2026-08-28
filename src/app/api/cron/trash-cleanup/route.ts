import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getAllSettings } from "@/lib/cloud/settings";
import { purgeSubtree } from "@/lib/cloud/tree";
import { safeSecretCompare } from "@/lib/auth/cron-secret";

/**
 * CRON endpoint — purges trash older than trashRetentionDays.
 *
 * Auth: X-Cron-Secret header must match CRON_SECRET env var (timing-safe).
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — endpoint disabled" },
      { status: 503 }
    );
  }
  if (expectedSecret === "replace-me-with-a-random-cron-secret") {
    return NextResponse.json(
      { error: "CRON_SECRET is still the .env.example placeholder — endpoint disabled" },
      { status: 503 }
    );
  }
  const providedSecret = req.headers.get("x-cron-secret");
  if (!safeSecretCompare(providedSecret, expectedSecret)) {
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

  // Find soft-deleted nodes older than the cutoff.
  //
  // We only want TOP-LEVEL trash entries — nodes whose parent is either
  // null OR not itself trashed. This mirrors the list route's definition of
  // "trashed item the user sees in the trash bin". If we sweep a child file
  // whose parent folder is also expired, purgeSubtree() will catch it as part
  // of the folder; if the parent folder is NOT yet expired, the child should
  // stay too.
  //
  // The previous query did NOT filter for top-level — it picked every
  // expired node, so children of an expired folder were processed twice,
  // AND files whose own deletedAt was inside the retention window got
  // purged when their parent crossed the cutoff.
  const expired = await db.fileNode.findMany({
    where: {
      deletedAt: { lt: cutoff, not: null },
      OR: [
        { parentId: null },
        { parent: { deletedAt: null } },
      ],
    },
    select: {
      id: true, ownerId: true, storageKey: true,
      isDirectory: true, name: true, sizeBytes: true,
    },
  });

  const storage = await getStorage();
  let purgedFiles = 0;
  let purgedDirs = 0;
  let freedBytes = 0n;

  for (const node of expired) {
    if (node.isDirectory) {
      // Pass retentionCutoff so purgeSubtree skips descendants whose own
      // deletedAt is still inside the retention window (or null — an active
      // file that happened to live under a trashed folder).
      try {
        await purgeSubtree(node.ownerId, node.id, storage, {
          retentionCutoff: cutoff,
          onPurgedFile: (sz) => { freedBytes += sz; },
        });
        purgedDirs += 1;
      } catch {
        // best-effort
      }
    } else {
      try {
        await storage.delete(node.storageKey);
      } catch {
        // best-effort — DB record is removed regardless.
      }
      freedBytes += node.sizeBytes;
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
