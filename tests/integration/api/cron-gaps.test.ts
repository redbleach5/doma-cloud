/**
 * Cron coverage for share-cleanup and uploads-cleanup (previously uncovered).
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { POST as shareCleanup } from "@/app/api/cron/share-cleanup/route";
import { POST as uploadsCleanup } from "@/app/api/cron/uploads-cleanup/route";
import { db, resetDb, seedUser, seedFile, seedShare } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { getStorage } from "@/lib/storage";

const CRON = "real-cron-secret-for-testing";

describe("POST /api/cron/share-cleanup", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    process.env.CRON_SECRET = CRON;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("returns 503 when CRON_SECRET is missing or placeholder", async () => {
    delete process.env.CRON_SECRET;
    expect((await callRoute(shareCleanup, { method: "POST" })).response.status).toBe(503);

    process.env.CRON_SECRET = "replace-me-with-a-random-cron-secret";
    expect((await callRoute(shareCleanup, { method: "POST" })).response.status).toBe(503);
  });

  it("returns 401 with a wrong secret", async () => {
    const { response } = await callRoute(shareCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "nope" },
    });
    expect(response.status).toBe(401);
  });

  it("purges expired and exhausted shares; keeps oneTimeUse with remaining views", async () => {
    const user = await seedUser({ username: "alice" });
    const file = await seedFile({ ownerId: user.id, name: "a.txt" });

    const expired = await seedShare({
      nodeId: file.id,
      createdBy: user.id,
      token: "expired-tok",
      expiresAt: new Date(Date.now() - 60_000),
    });

    // Historical bug: oneTimeUse + maxViews>1 was wiped at usedCount>=1.
    const stillValid = await seedShare({
      nodeId: file.id,
      createdBy: user.id,
      token: "ot-alive",
      oneTimeUse: true,
      maxViews: 5,
      usedCount: 1,
    });

    const exhaustedOt = await seedShare({
      nodeId: file.id,
      createdBy: user.id,
      token: "ot-dead",
      oneTimeUse: true,
      maxViews: 2,
      usedCount: 2,
    });

    const exhaustedMax = await seedShare({
      nodeId: file.id,
      createdBy: user.id,
      token: "max-dead",
      oneTimeUse: false,
      maxViews: 3,
      usedCount: 3,
    });

    const keep = await seedShare({
      nodeId: file.id,
      createdBy: user.id,
      token: "keep-tok",
      maxViews: 10,
      usedCount: 1,
    });

    const { response, data } = await callRoute<{
      ok: boolean;
      expiredByDate: number;
      exhaustedOneTime: number;
      exhaustedByViews: number;
      totalPurged: number;
    }>(shareCleanup, {
      method: "POST",
      headers: { "x-cron-secret": CRON },
    });

    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.expiredByDate).toBe(1);
    expect(data!.exhaustedOneTime).toBe(1);
    expect(data!.exhaustedByViews).toBe(1);
    expect(data!.totalPurged).toBe(3);

    expect(await db.share.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await db.share.findUnique({ where: { id: exhaustedOt.id } })).toBeNull();
    expect(await db.share.findUnique({ where: { id: exhaustedMax.id } })).toBeNull();
    expect(await db.share.findUnique({ where: { id: stillValid.id } })).not.toBeNull();
    expect(await db.share.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });
});

describe("POST /api/cron/uploads-cleanup", () => {
  let storageRoot: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    const temp = await makeTempStorage();
    storageRoot = temp.root;
    process.env.CRON_SECRET = CRON;
  });

  afterEach(async () => {
    await cleanupTempStorage();
    delete process.env.CRON_SECRET;
  });

  it("returns 401 without a matching cron secret", async () => {
    const { response } = await callRoute(uploadsCleanup, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("removes stale .uploads sessions and keeps fresh ones", async () => {
    const storage = await getStorage();
    const staleKey = ".uploads/user-stale/old-up/session.json";
    const freshKey = ".uploads/user-fresh/new-up/session.json";
    await storage.put(staleKey, Buffer.from('{"fileName":"old.bin"}'));
    await storage.put(freshKey, Buffer.from('{"fileName":"new.bin"}'));

    const stalePath = path.join(storageRoot, staleKey);
    const old = (Date.now() - 48 * 3600_000) / 1000;
    await fs.utimes(stalePath, old, old);

    const { response, data } = await callRoute<{
      ok: boolean;
      removedSessions: number;
    }>(uploadsCleanup, {
      method: "POST",
      headers: { "x-cron-secret": CRON },
    });

    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.removedSessions).toBe(1);

    await expect(storage.getBuffer(staleKey)).rejects.toThrow();
    const fresh = await storage.getBuffer(freshKey);
    expect(fresh.toString()).toContain("new.bin");
  });
});
