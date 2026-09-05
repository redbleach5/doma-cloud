import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCachedLocalStorageRoot, getStorage } from "@/lib/storage";
import { safeSecretCompare } from "@/lib/auth/cron-secret";

/**
 * CRON endpoint — cleans up stale `.uploads/` temp directories.
 *
 * When a chunked upload is interrupted (browser closed, network lost, server
 * restart), partial chunks and session metadata stay under `.uploads/` forever.
 * This cron removes upload sessions whose newest file is older than 24 hours.
 *
 * Uses `storage.list(".uploads/")` when available; falls back to a
 * filesystem walk otherwise.
 *
 * Trigger:
 *   curl -X POST http://localhost:3000/api/cron/uploads-cleanup \
 *     -H "X-Cron-Secret: $CRON_SECRET"
 */

const MAX_AGE_HOURS = 24;
const UPLOAD_PREFIX = ".uploads/";

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

  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
  const storage = await getStorage();

  if (typeof storage.list === "function") {
    const result = await cleanupViaStorageList(
      storage as {
        list(prefix: string): Promise<string[]>;
        stat(key: string): Promise<{ size: number; mtime: Date }>;
        delete(key: string): Promise<void>;
      },
      cutoff
    );
    return NextResponse.json({
      ok: true,
      backend: "storage-list",
      ...result,
      maxAgeHours: MAX_AGE_HOURS,
    });
  }

  const result = await cleanupViaLocalFilesystem(cutoff);
  return NextResponse.json({
    ok: true,
    backend: "local-fs",
    ...result,
    maxAgeHours: MAX_AGE_HOURS,
  });
}

async function cleanupViaStorageList(
  storage: {
    list(prefix: string): Promise<string[]>;
    stat(key: string): Promise<{ size: number; mtime: Date }>;
    delete(key: string): Promise<void>;
  },
  cutoff: number
) {
  // LocalFileStorage.list() is intentionally shallow (one directory level) —
  // upload abort uses list(".uploads/<user>/<id>/"). Walk three levels here
  // so we actually see session files, not just `.uploads/<user>` dirs.
  const keys = await listUploadSessionObjectKeys(storage);
  const sessions = groupUploadSessionKeys(keys);
  let removedSessions = 0;
  let removedBytes = 0n;

  for (const [sessionPrefix, sessionKeys] of sessions.entries()) {
    let newest = 0;
    let sessionBytes = 0n;
    for (const key of sessionKeys) {
      try {
        const st = await storage.stat(key);
        newest = Math.max(newest, st.mtime.getTime());
        sessionBytes += BigInt(st.size);
      } catch {
        // ignore missing keys
      }
    }
    if (newest === 0 || newest >= cutoff) continue;

    for (const key of sessionKeys) {
      await storage.delete(key).catch(() => undefined);
    }
    // Best-effort: also remove empty session / user dirs via local FS walker
    // when available (storage.delete only unlinks files).
    void sessionPrefix;
    removedSessions += 1;
    removedBytes += sessionBytes;
  }

  return { removedSessions, removedBytes: removedBytes.toString() };
}

/**
 * Expand shallow list() into object keys under `.uploads/<user>/<uploadId>/…`.
 */
async function listUploadSessionObjectKeys(storage: {
  list(prefix: string): Promise<string[]>;
}): Promise<string[]> {
  const users = await storage.list(UPLOAD_PREFIX).catch(() => [] as string[]);
  const objectKeys: string[] = [];
  for (const userKey of users) {
    const userPrefix = userKey.endsWith("/") ? userKey : `${userKey}/`;
    const sessions = await storage.list(userPrefix).catch(() => [] as string[]);
    for (const sessionKey of sessions) {
      const sessionPrefix = sessionKey.endsWith("/") ? sessionKey : `${sessionKey}/`;
      const files = await storage.list(sessionPrefix).catch(() => [] as string[]);
      if (files.length === 0) {
        // Empty session dir, or a stray file at the session path.
        objectKeys.push(sessionKey);
      } else {
        objectKeys.push(...files);
      }
    }
  }
  return objectKeys;
}

/** Group `.uploads/<user>/<uploadId>/...` keys by session prefix. */
function groupUploadSessionKeys(keys: string[]): Map<string, string[]> {
  const sessions = new Map<string, string[]>();
  for (const key of keys) {
    const parts = key.split("/");
    if (parts.length < 3 || parts[0] !== ".uploads") continue;
    const prefix = `${parts[0]}/${parts[1]}/${parts[2]}/`;
    const list = sessions.get(prefix) ?? [];
    list.push(key);
    sessions.set(prefix, list);
  }
  return sessions;
}

async function cleanupViaLocalFilesystem(cutoff: number) {
  const root = getCachedLocalStorageRoot();
  if (!root) {
    return { removedSessions: 0, removedBytes: "0", message: "no local root cached — skipping" };
  }

  const uploadsRoot = path.join(root, ".uploads");
  let removedSessions = 0;
  let removedBytes = 0n;

  try {
    const userDirs = await fs.readdir(uploadsRoot).catch(() => []);
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
        let newest = 0;
        let sessionBytes = 0n;
        try {
          await walkAndCount(sessionPath, (sz, mtimeMs) => {
            sessionBytes += BigInt(sz);
            newest = Math.max(newest, mtimeMs);
          });
        } catch {
          continue;
        }
        // Use newest *file* mtime (not the session directory itself) so a
        // stale session whose dir was recently remounted still ages out.
        if (newest === 0 || newest >= cutoff) continue;

        try {
          await fs.rm(sessionPath, { recursive: true, force: true });
          removedSessions += 1;
          removedBytes += sessionBytes;
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // best-effort
  }

  return { removedSessions, removedBytes: removedBytes.toString() };
}

async function walkAndCount(
  dir: string,
  onFile: (size: number, mtimeMs: number) => void
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkAndCount(p, onFile);
    } else if (e.isFile()) {
      const st = await fs.stat(p).catch(() => null);
      if (st) onFile(st.size, st.mtimeMs);
    }
  }
}

/** GET — same as POST but for cron services that only support GET. */
export async function GET(req: NextRequest) {
  return POST(req);
}
