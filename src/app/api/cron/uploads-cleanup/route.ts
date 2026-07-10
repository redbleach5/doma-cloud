import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCachedLocalStorageRoot, getStorage } from "@/lib/storage";

/**
 * CRON endpoint — cleans up stale `.uploads/` temp directories.
 *
 * When a chunked upload is interrupted (browser closed, network lost, server
 * restart), the partial chunks and session.json stay in
 * `<storage-root>/.uploads/<user>/<uploadId>/` forever. Over time this fills
 * the disk with orphan bytes that aren't counted in any user's quota.
 *
 * This cron walks `.uploads/<user>/<uploadId>/` and removes any
 * `<uploadId>/` directory whose mtime is older than 24 hours. It only runs
 * for the LOCAL storage backend — S3 cleanup is a TODO (would need to list
 * objects under `.uploads/` and check LastModified).
 *
 * Trigger:
 *   curl -X POST http://localhost:3000/api/cron/uploads-cleanup \
 *     -H "X-Cron-Secret: $CRON_SECRET"
 */

const MAX_AGE_HOURS = 24;

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || expectedSecret === "replace-me-with-a-random-cron-secret") {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — endpoint disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("x-cron-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = await getStorage();
  // Only LocalFileStorage has a filesystem we can walk with fs.readdir.
  // S3 cleanup would require listing objects — skipped for now.
  const root = getCachedLocalStorageRoot();
  if (!root) {
    return NextResponse.json({ ok: true, message: "no local root cached — skipping" });
  }

  const uploadsRoot = path.join(root, ".uploads");
  let removedSessions = 0;
  let removedBytes = 0n;

  try {
    const userDirs = await fs.readdir(uploadsRoot).catch(() => []);
    const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;

    for (const userDir of userDirs) {
      const userPath = path.join(uploadsRoot, userDir);
      let userStat;
      try {
        userStat = await fs.stat(userPath);
      } catch {
        continue;
      }
      if (!userStat.isDirectory()) continue;

      const sessionDirs = await fs.readdir(userPath).catch(() => []);
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(userPath, sessionDir);
        let sessionStat;
        try {
          sessionStat = await fs.stat(sessionPath);
        } catch {
          continue;
        }
        if (sessionStat.mtimeMs >= cutoff) continue;

        // Compute size before removal (best-effort).
        try {
          await walkAndCount(sessionPath, (sz) => { removedBytes += BigInt(sz); });
        } catch {
          // ignore — we'll still try to remove
        }

        try {
          await fs.rm(sessionPath, { recursive: true, force: true });
          removedSessions += 1;
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // best-effort
  }

  return NextResponse.json({
    ok: true,
    removedSessions,
    removedBytes: removedBytes.toString(),
    maxAgeHours: MAX_AGE_HOURS,
  });
}

async function walkAndCount(dir: string, onSize: (n: number) => void): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkAndCount(p, onSize);
    } else if (e.isFile()) {
      const st = await fs.stat(p).catch(() => null);
      if (st) onSize(st.size);
    }
  }
}

/** GET — same as POST but for cron services that only support GET. */
export async function GET(req: NextRequest) {
  return POST(req);
}
