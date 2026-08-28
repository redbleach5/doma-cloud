import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GET as getProfile, PATCH as updateProfile } from "@/app/api/profile/route";
import { POST as changePassword } from "@/app/api/profile/password/route";
import { POST as trashCleanup } from "@/app/api/cron/trash-cleanup/route";
import { db, resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies, getMockCookie } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { verifyPassword, hashPassword } from "@/lib/auth/password";

describe("GET /api/profile", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(getProfile, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("returns the profile of the authenticated user", async () => {
    const u = await seedUser({ username: "alice", displayName: "Alice" });
    const token = await makeSessionToken(u);
    const { response, data } = await callRoute<{ user: { username: string; displayName: string; birthday: string | null; themePreference: string | null } }>(getProfile, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user.username).toBe("alice");
    expect(data!.user.displayName).toBe("Alice");
    expect(data!.user.birthday).toBeNull();
    expect(data!.user.themePreference).toBeNull();
  });
});

describe("PATCH /api/profile", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice", displayName: "Alice" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(updateProfile, {
      method: "PATCH",
      body: { displayName: "New" },
    });
    expect(response.status).toBe(401);
  });

  it("updates displayName", async () => {
    const { response, data } = await callRoute<{ user: { displayName: string } }>(updateProfile, {
      method: "PATCH",
      body: { displayName: "Alice Smith" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user.displayName).toBe("Alice Smith");
  });

  it("updates birthday", async () => {
    const birthday = "1995-03-20T00:00:00.000Z";
    const { response, data } = await callRoute<{ user: { birthday: string | null } }>(
      updateProfile,
      {
        method: "PATCH",
        body: { birthday },
        cookies: { doma_session: token },
      }
    );
    expect(response.status).toBe(200);
    // API normalizes to UTC noon so the calendar day is preserved worldwide.
    expect(data!.user.birthday).toBe("1995-03-20T12:00:00.000Z");
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u?.birthday?.toISOString()).toBe("1995-03-20T12:00:00.000Z");
  });

  it("round-trips birthday date-input day without shifting for timezone", async () => {
    const { toBirthdayIso, birthdayDateInputValue } = await import("@/lib/cloud/birthday");
    const iso = toBirthdayIso("1995-03-20");
    const { response, data } = await callRoute<{ user: { birthday: string | null } }>(
      updateProfile,
      {
        method: "PATCH",
        body: { birthday: iso },
        cookies: { doma_session: token },
      }
    );
    expect(response.status).toBe(200);
    expect(birthdayDateInputValue(data!.user.birthday)).toBe("1995-03-20");
  });

  it("clears birthday with null", async () => {
    // First set a birthday.
    await db.user.update({
      where: { id: user.id },
      data: { birthday: new Date("1990-01-01") },
    });
    // Now clear it.
    const { response } = await callRoute(updateProfile, {
      method: "PATCH",
      body: { birthday: null },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u?.birthday).toBeNull();
  });

  it("updates themePreference", async () => {
    const { response, data } = await callRoute<{ user: { themePreference: string | null } }>(updateProfile, {
      method: "PATCH",
      body: { themePreference: "dark" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user.themePreference).toBe("dark");
  });

  it("rejects an invalid themePreference", async () => {
    const { response } = await callRoute(updateProfile, {
      method: "PATCH",
      body: { themePreference: "purple" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("trims displayName", async () => {
    const { data } = await callRoute<{ user: { displayName: string } }>(updateProfile, {
      method: "PATCH",
      body: { displayName: "  Spaced  " },
      cookies: { doma_session: token },
    });
    expect(data!.user.displayName).toBe("Spaced");
  });
});

describe("POST /api/profile/password", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;
  let currentPassword: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    currentPassword = "old-password-123";
    const u = await seedUser({ username: "alice", password: currentPassword });
    user = u;
    token = await makeSessionToken(u);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(changePassword, {
      method: "POST",
      body: { currentPassword, newPassword: "new-password-123" },
    });
    expect(response.status).toBe(401);
  });

  it("changes the password when the current one is correct", async () => {
    const { response, data } = await callRoute<{ ok: boolean }>(changePassword, {
      method: "POST",
      body: { currentPassword, newPassword: "new-password-123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    // Verify the new password works.
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword("new-password-123", u!.passwordHash)).toBe(true);
  });

  it("returns 403 when the current password is wrong", async () => {
    const { response } = await callRoute(changePassword, {
      method: "POST",
      body: { currentPassword: "wrong-current", newPassword: "new-password-123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(403);
  });

  it("returns 422 when the new password is too short", async () => {
    const { response } = await callRoute(changePassword, {
      method: "POST",
      body: { currentPassword, newPassword: "12345" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("increments tokenVersion (invalidates other sessions)", async () => {
    const initialVersion = user.tokenVersion;
    await callRoute(changePassword, {
      method: "POST",
      body: { currentPassword, newPassword: "new-password-123" },
      cookies: { doma_session: token },
    });
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u?.tokenVersion).toBe(initialVersion + 1);
  });

  it("issues a fresh session cookie with the new tokenVersion", async () => {
    await callRoute(changePassword, {
      method: "POST",
      body: { currentPassword, newPassword: "new-password-123" },
      cookies: { doma_session: token },
    });
    // A new doma_session cookie should have been set (replacing the old one).
    const newCookie = getMockCookie("doma_session");
    expect(newCookie).toBeDefined();
    expect(newCookie).not.toBe(token); // different (new tokenVersion baked in)
  });
});

describe("POST /api/cron/trash-cleanup", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    // Set a real CRON_SECRET (not the placeholder).
    process.env.CRON_SECRET = "real-cron-secret-for-testing";
  });

  afterEach(async () => {
    await cleanupTempStorage();
    delete process.env.CRON_SECRET;
  });

  it("returns 503 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const { response } = await callRoute(trashCleanup, { method: "POST" });
    expect(response.status).toBe(503);
  });

  it("returns 503 when CRON_SECRET is the .env.example placeholder", async () => {
    process.env.CRON_SECRET = "replace-me-with-a-random-cron-secret";
    const { response } = await callRoute(trashCleanup, { method: "POST" });
    expect(response.status).toBe(503);
  });

  it("returns 401 when the secret header doesn't match", async () => {
    const { response } = await callRoute(trashCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "wrong-secret" },
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 when no secret header is provided", async () => {
    const { response } = await callRoute(trashCleanup, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("returns ok with purgedCount=0 when trashRetentionDays=0 (disabled)", async () => {
    await db.setting.create({ data: { key: "trashRetentionDays", value: "0" } });
    const { response, data } = await callRoute<{ ok: boolean; purgedCount: number; message?: string }>(trashCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "real-cron-secret-for-testing" },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.purgedCount).toBe(0);
  });

  it("purges trash older than the retention period", async () => {
    // Set retention to 7 days.
    await db.setting.create({ data: { key: "trashRetentionDays", value: "7" } });
    const user = await seedUser({ username: "alice" });
    // A file trashed 10 days ago (older than 7-day retention).
    const oldTrashed = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "old.txt",
      sizeBytes: 100n,
      deletedAt: new Date(Date.now() - 10 * 86400_000),
    });
    // A file trashed 1 day ago (within retention).
    const recentTrashed = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "recent.txt",
      sizeBytes: 50n,
      deletedAt: new Date(Date.now() - 1 * 86400_000),
    });
    const { response, data } = await callRoute<{ ok: boolean; purgedFiles: number }>(trashCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "real-cron-secret-for-testing" },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.purgedFiles).toBe(1);
    // Old file is gone, recent file stays.
    expect(await db.fileNode.findUnique({ where: { id: oldTrashed.id } })).toBeNull();
    expect(await db.fileNode.findUnique({ where: { id: recentTrashed.id } })).not.toBeNull();
  });

  it("does not purge non-trashed files", async () => {
    await db.setting.create({ data: { key: "trashRetentionDays", value: "1" } });
    const user = await seedUser({ username: "alice" });
    const active = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "active.txt",
      sizeBytes: 100n,
    });
    await callRoute(trashCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "real-cron-secret-for-testing" },
    });
    expect(await db.fileNode.findUnique({ where: { id: active.id } })).not.toBeNull();
  });

  it("also works via GET (for cron services that only support GET)", async () => {
    await db.setting.create({ data: { key: "trashRetentionDays", value: "0" } });
    const { response, data } = await callRoute<{ ok: boolean }>(trashCleanup, {
      method: "GET",
      headers: { "x-cron-secret": "real-cron-secret-for-testing" },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
  });

  it("recomputes usedBytes for affected users after purge", async () => {
    await db.setting.create({ data: { key: "trashRetentionDays", value: "1" } });
    const user = await seedUser({ username: "alice" });
    // Set a wrong usedBytes value.
    await db.user.update({ where: { id: user.id }, data: { usedBytes: 999n } });
    // Trash an old file.
    await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "old.txt",
      sizeBytes: 100n,
      deletedAt: new Date(Date.now() - 10 * 86400_000),
    });
    await callRoute(trashCleanup, {
      method: "POST",
      headers: { "x-cron-secret": "real-cron-secret-for-testing" },
    });
    // usedBytes should have been recomputed (no non-deleted files → 0).
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u?.usedBytes).toBe(0n);
  });
});
