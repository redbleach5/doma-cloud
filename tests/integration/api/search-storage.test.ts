/**
 * users/search roster + admin storage GET / successful PATCH.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { GET as searchUsers } from "@/app/api/users/search/route";
import { GET as getStorage, PATCH as setStorage } from "@/app/api/admin/storage/route";
import { db, resetDb, seedUser, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { getSetting } from "@/lib/cloud/settings";

describe("GET /api/users/search", () => {
  let alice: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let bob: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let carol: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let aliceToken: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    alice = await seedUser({ username: "alice", displayName: "Alice" });
    bob = await seedUser({ username: "bob", displayName: "Bob" });
    carol = await seedUser({ username: "carol", displayName: "Carol" });
    aliceToken = await makeSessionToken(alice);
  });

  it("returns 401 without a session", async () => {
    const { response } = await callRoute(searchUsers, {
      method: "GET",
      url: "http://localhost:3000/api/users/search",
    });
    expect(response.status).toBe(401);
  });

  it("empty q lists the family roster excluding the caller", async () => {
    const { response, data } = await callRoute<{
      users: Array<{ id: string; username: string }>;
    }>(searchUsers, {
      method: "GET",
      url: "http://localhost:3000/api/users/search?q=",
      cookies: { doma_session: aliceToken },
    });
    expect(response.status).toBe(200);
    const ids = data!.users.map((u) => u.id);
    expect(ids).toContain(bob.id);
    expect(ids).toContain(carol.id);
    expect(ids).not.toContain(alice.id);
  });

  it("prefix q matches usernames case-insensitively and excludes self", async () => {
    const { response, data } = await callRoute<{
      users: Array<{ id: string; username: string }>;
    }>(searchUsers, {
      method: "GET",
      url: "http://localhost:3000/api/users/search?q=Bo",
      cookies: { doma_session: aliceToken },
    });
    expect(response.status).toBe(200);
    expect(data!.users.map((u) => u.username)).toEqual(["bob"]);
  });
});

describe("GET/PATCH /api/admin/storage", () => {
  let admin: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    admin = await seedUser({ username: "admin", role: "admin" });
    adminToken = await makeSessionToken(admin);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("GET returns storage status for admins", async () => {
    const { response, data } = await callRoute<{
      dbConfiguredRoot: string | null;
      envConfiguredRoot: string | null;
      localRoot: string | null;
    }>(getStorage, {
      method: "GET",
      url: "http://localhost:3000/api/admin/storage?skipUsed=1",
      cookies: { doma_session: adminToken },
    });
    expect(response.status).toBe(200);
    expect(data!.envConfiguredRoot).toBeTruthy();
    expect(data).toHaveProperty("dbConfiguredRoot");
  });

  it("PATCH sets a writable absolute root and persists the setting", async () => {
    const newRoot = await fs.mkdtemp(path.join(os.tmpdir(), "doma-admin-storage-"));
    try {
      const { response, data } = await callRoute<{
        ok: boolean;
        storageLocalRoot: string;
      }>(setStorage, {
        method: "PATCH",
        body: { storageLocalRoot: newRoot },
        cookies: { doma_session: adminToken },
      });
      expect(response.status).toBe(200);
      expect(data!.ok).toBe(true);
      expect(data!.storageLocalRoot).toBe(newRoot);

      const saved = await getSetting("storageLocalRoot");
      expect(saved).toBe(newRoot);
    } finally {
      await fs.rm(newRoot, { recursive: true, force: true }).catch(() => undefined);
      await db.setting.deleteMany({ where: { key: "storageLocalRoot" } });
    }
  });
});
