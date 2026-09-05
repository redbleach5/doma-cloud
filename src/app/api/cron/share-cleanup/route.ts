import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeSecretCompare } from "@/lib/auth/cron-secret";

/**
 * CRON endpoint — purges expired / exhausted link-shares.
 *
 * Removes Share rows where:
 *   - expiresAt < now, OR
 *   - oneTimeUse = true AND usedCount >= (maxViews ?? 1), OR
 *   - maxViews IS NOT NULL AND usedCount >= maxViews
 *
 * Auth: X-Cron-Secret header must match CRON_SECRET env var (timing-safe).
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || expectedSecret === "replace-me-with-a-random-cron-secret") {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — endpoint disabled" },
      { status: 503 }
    );
  }
  if (!safeSecretCompare(req.headers.get("x-cron-secret"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Expired by date.
  const expiredByDate = await db.share.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  // Exhausted one-time-use shares.
  //
  // IMPORTANT: the verify route (api/share/[token]) treats `oneTimeUse` as
  // `maxViews = maxViews ?? 1`. So a share with `{ oneTimeUse: true,
  // maxViews: 5 }` is allowed 5 views. The previous logic deleted ANY
  // one-time-use share with `usedCount >= 1`, which wiped shares that still
  // had views 2..5 left — they silently 410'd for the recipient.
  const oneTimeCandidates = await db.share.findMany({
    where: { oneTimeUse: true },
    select: { id: true, maxViews: true, usedCount: true },
  });
  const oneTimeExhaustedIds = oneTimeCandidates
    .filter((s) => s.usedCount >= (s.maxViews ?? 1))
    .map((s) => s.id);
  let exhaustedOneTime = 0;
  if (oneTimeExhaustedIds.length > 0) {
    const res = await db.share.deleteMany({ where: { id: { in: oneTimeExhaustedIds } } });
    exhaustedOneTime = res.count;
  }

  // Exhausted max-views shares (non-one-time-use, since oneTimeUse shares
  // are already handled above).
  const candidates = await db.share.findMany({
    where: { maxViews: { not: null }, oneTimeUse: false },
    select: { id: true, maxViews: true, usedCount: true },
  });
  const exhaustedIds = candidates
    .filter((s) => s.maxViews !== null && s.usedCount >= s.maxViews)
    .map((s) => s.id);
  let exhaustedByViews = 0;
  if (exhaustedIds.length > 0) {
    const res = await db.share.deleteMany({ where: { id: { in: exhaustedIds } } });
    exhaustedByViews = res.count;
  }

  return NextResponse.json({
    ok: true,
    expiredByDate: expiredByDate.count,
    exhaustedOneTime,
    exhaustedByViews,
    totalPurged: expiredByDate.count + exhaustedOneTime + exhaustedByViews,
    cutoff: now.toISOString(),
  });
}

/** GET — same as POST but for cron services that only support GET. */
export async function GET(req: NextRequest) {
  return POST(req);
}
