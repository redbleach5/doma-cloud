import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GET as listUsers, POST as createUser } from "@/app/api/admin/users/route";
import { PATCH as updateUser, DELETE as deleteUser } from "@/app/api/admin/users/[id]/route";
import { POST as resetPassword } from "@/app/api/admin/users/[id]/reset-password/route";
import { GET as getStats } from "@/app/api/admin/stats/route";
import { GET as getSettings, PATCH as updateSettings } from "@/app/api/admin/settings/route";
import { POST as recomputeQuotas } from "@/app/api/admin/recompute-quotas/route";
import { db, resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";

async function makeAdminAndToken() {
  const admin = await seedUser({ username: "admin", role: "admin" });
  const token = await makeSessionToken(admin);
  return { admin, token };
}

async function makeUserAndToken() {
  const user = await seedUser({ username: "regular", role: "user" });
  const token = await makeSessionToken(user);
  return { user, token };
}

describe("Admin guard (requireAdmin)", () => {
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
    const { response } = await callRoute(listUsers, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("returns 403 when authenticated as a non-admin", async () => {
    const { token } = await makeUserAndToken();
    const { response } = await callRoute(listUsers, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(403);
  });

  it("allows access for admins", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(listUsers, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/admin/users", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("lists all users", async () => {
    const { admin, token } = await makeAdminAndToken();
    await seedUser({ username: "bob", role: "user" });
    await seedUser({ username: "carol", role: "user" });
    const { data } = await callRoute<{ users: { id: string; username: string }[] }>(listUsers, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.users).toHaveLength(3);
    expect(data!.users.map((u) => u.username).sort()).toEqual(["admin", "bob", "carol"]);
  });

  it("includes quota and used bytes as strings", async () => {
    const { token } = await makeAdminAndToken();
    const { data } = await callRoute<{ users: { quotaBytes: string; usedBytes: string }[] }>(listUsers, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(typeof data!.users[0].quotaBytes).toBe("string");
    expect(typeof data!.users[0].usedBytes).toBe("string");
  });
});

describe("POST /api/admin/users (create user)", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("creates a new user with default role and quota", async () => {
    const { token } = await makeAdminAndToken();
    const { response, data } = await callRoute<{ user: { role: string; quotaBytes: string } }>(createUser, {
      method: "POST",
      body: { username: "newbie", password: "password123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user.role).toBe("user");
    // Default quota: 50 GB
    expect(BigInt(data!.user.quotaBytes)).toBe(50n * 1024n * 1024n * 1024n);
  });

  it("creates an admin user with admin quota", async () => {
    const { token } = await makeAdminAndToken();
    const { data } = await callRoute<{ user: { role: string; quotaBytes: string } }>(createUser, {
      method: "POST",
      body: { username: "admin2", password: "password123", role: "admin" },
      cookies: { doma_session: token },
    });
    expect(data!.user.role).toBe("admin");
    // Admin quota: 3 TB
    expect(BigInt(data!.user.quotaBytes)).toBe(3n * 1024n * 1024n * 1024n * 1024n);
  });

  it("creates a user with a custom quota", async () => {
    const { token } = await makeAdminAndToken();
    const customQuota = (10n * 1024n * 1024n * 1024n).toString();
    const { data } = await callRoute<{ user: { quotaBytes: string } }>(createUser, {
      method: "POST",
      body: { username: "custom", password: "password123", quotaBytes: customQuota },
      cookies: { doma_session: token },
    });
    expect(BigInt(data!.user.quotaBytes)).toBe(10n * 1024n * 1024n * 1024n);
  });

  it("returns 409 for a duplicate username", async () => {
    const { token } = await makeAdminAndToken();
    await seedUser({ username: "existing" });
    const { response } = await callRoute(createUser, {
      method: "POST",
      body: { username: "existing", password: "password123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(409);
  });

  it("returns 422 for invalid input (short username)", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(createUser, {
      method: "POST",
      body: { username: "ab", password: "password123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 422 for invalid input (short password)", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(createUser, {
      method: "POST",
      body: { username: "newbie", password: "12345" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("updates a user's displayName", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target", displayName: "Old" });
    const { response, data } = await callRoute<{ user: { displayName: string } }>(updateUser, {
      method: "PATCH",
      params: { id: target.id },
      body: { displayName: "New Name" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user.displayName).toBe("New Name");
  });

  it("updates a user's quota", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target" });
    const newQuota = (200n * 1024n * 1024n * 1024n).toString();
    const { data } = await callRoute<{ user: { quotaBytes: string } }>(updateUser, {
      method: "PATCH",
      params: { id: target.id },
      body: { quotaBytes: newQuota },
      cookies: { doma_session: token },
    });
    expect(BigInt(data!.user.quotaBytes)).toBe(200n * 1024n * 1024n * 1024n);
  });

  it("promotes a user to admin", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target", role: "user" });
    const { data } = await callRoute<{ user: { role: string } }>(updateUser, {
      method: "PATCH",
      params: { id: target.id },
      body: { role: "admin" },
      cookies: { doma_session: token },
    });
    expect(data!.user.role).toBe("admin");
  });

  it("refuses to demote the last admin", async () => {
    const admin = await seedUser({ username: "admin", role: "admin" });
    const token = await makeSessionToken(admin);
    const { response } = await callRoute(updateUser, {
      method: "PATCH",
      params: { id: admin.id },
      body: { role: "user" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("allows demoting an admin when other admins exist", async () => {
    const admin1 = await seedUser({ username: "admin1", role: "admin" });
    const token = await makeSessionToken(admin1);
    const admin2 = await seedUser({ username: "admin2", role: "admin" });
    const { response } = await callRoute(updateUser, {
      method: "PATCH",
      params: { id: admin2.id },
      body: { role: "user" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
  });

  it("returns 404 for a non-existent user", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(updateUser, {
      method: "PATCH",
      params: { id: "nonexistent" },
      body: { displayName: "x" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("updates birthday", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target" });
    const birthday = "1990-05-15T00:00:00.000Z";
    const { response } = await callRoute(updateUser, {
      method: "PATCH",
      params: { id: target.id },
      body: { birthday },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    const u = await db.user.findUnique({ where: { id: target.id } });
    expect(u?.birthday?.toISOString()).toBe("1990-05-15T12:00:00.000Z");
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("deletes a user and their files", async () => {
    const { admin, token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target" });
    await seedFile({ ownerId: target.id, parentId: null, name: "f.txt" });
    const { response, data } = await callRoute<{ ok: boolean; purgedFiles: number }>(deleteUser, {
      method: "DELETE",
      params: { id: target.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.purgedFiles).toBe(1);
    expect(await db.user.findUnique({ where: { id: target.id } })).toBeNull();
  });

  it("refuses to delete the last admin", async () => {
    const admin = await seedUser({ username: "admin", role: "admin" });
    const token = await makeSessionToken(admin);
    const { response } = await callRoute(deleteUser, {
      method: "DELETE",
      params: { id: admin.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("refuses to let an admin delete themselves", async () => {
    const { admin, token } = await makeAdminAndToken();
    // Create a second admin so the "last admin" check doesn't fire.
    await seedUser({ username: "admin2", role: "admin" });
    const { response } = await callRoute(deleteUser, {
      method: "DELETE",
      params: { id: admin.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 404 for a non-existent user", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(deleteUser, {
      method: "DELETE",
      params: { id: "nonexistent" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/admin/users/[id]/reset-password", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("resets a user's password and invalidates sessions", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target", password: "old-pass", tokenVersion: 0 });
    const { response } = await callRoute(resetPassword, {
      method: "POST",
      params: { id: target.id },
      body: { newPassword: "new-pass-123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    // tokenVersion should have been incremented to invalidate old sessions.
    const u = await db.user.findUnique({ where: { id: target.id } });
    expect(u?.tokenVersion).toBe(1);
  });

  it("returns 404 for a non-existent user", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(resetPassword, {
      method: "POST",
      params: { id: "nonexistent" },
      body: { newPassword: "new-pass-123" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 422 for a too-short password", async () => {
    const { token } = await makeAdminAndToken();
    const target = await seedUser({ username: "target" });
    const { response } = await callRoute(resetPassword, {
      method: "POST",
      params: { id: target.id },
      body: { newPassword: "12345" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });
});

describe("GET /api/admin/stats", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns aggregated stats", async () => {
    const { token } = await makeAdminAndToken();
    await seedUser({ username: "u1", role: "user" });
    await seedUser({ username: "u2", role: "user" });
    const { response, data } = await callRoute<{
      users: { total: number; admins: number; active: number; neverLoggedIn: number };
      storage: { fileCount: number; trashCount: number; sharesCount: number };
    }>(getStats, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.users.total).toBe(3); // admin + u1 + u2
    expect(data!.users.admins).toBe(1);
    expect(data!.storage.fileCount).toBe(0);
  });

  it("counts active vs never-logged-in users", async () => {
    const { token } = await makeAdminAndToken();
    // seedUser doesn't accept lastLoginAt — set it via db.update.
    const activeUser = await seedUser({ username: "active" });
    await db.user.update({ where: { id: activeUser.id }, data: { lastLoginAt: new Date() } });
    await seedUser({ username: "never" });
    const { data } = await callRoute<{ users: { active: number; neverLoggedIn: number } }>(getStats, {
      method: "GET",
      cookies: { doma_session: token },
    });
    // admin (never), active (active), never (never)
    expect(data!.users.neverLoggedIn).toBe(2);
    expect(data!.users.active).toBe(1);
  });

  it("counts files and trash", async () => {
    const { admin, token } = await makeAdminAndToken();
    await seedFile({ ownerId: admin.id, parentId: null, name: "active.txt", sizeBytes: 100n });
    await seedFile({ ownerId: admin.id, parentId: null, name: "trashed.txt", sizeBytes: 50n, deletedAt: new Date() });
    const { data } = await callRoute<{ storage: { fileCount: number; trashCount: number; usedBytes: string; trashBytes: string } }>(getStats, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.storage.fileCount).toBe(1);
    expect(data!.storage.trashCount).toBe(1);
    expect(BigInt(data!.storage.usedBytes)).toBe(100n);
    expect(BigInt(data!.storage.trashBytes)).toBe(50n);
  });
});

describe("GET /api/admin/settings", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns current settings with defaults applied", async () => {
    const { token } = await makeAdminAndToken();
    const { response, data } = await callRoute<{ settings: { defaultQuotaBytes: string; adminQuotaBytes: string; registrationOpen: boolean; trashRetentionDays: number } }>(getSettings, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(BigInt(data!.settings.defaultQuotaBytes)).toBe(50n * 1024n * 1024n * 1024n);
    expect(BigInt(data!.settings.adminQuotaBytes)).toBe(3n * 1024n * 1024n * 1024n * 1024n);
    expect(data!.settings.registrationOpen).toBe(true);
    expect(data!.settings.trashRetentionDays).toBe(30);
  });
});

describe("PATCH /api/admin/settings", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("updates defaultQuotaBytes", async () => {
    const { token } = await makeAdminAndToken();
    const newQuota = (100n * 1024n * 1024n * 1024n).toString();
    const { data } = await callRoute<{ settings: { defaultQuotaBytes: string } }>(updateSettings, {
      method: "PATCH",
      body: { defaultQuotaBytes: newQuota },
      cookies: { doma_session: token },
    });
    expect(BigInt(data!.settings.defaultQuotaBytes)).toBe(100n * 1024n * 1024n * 1024n);
  });

  it("updates registrationOpen", async () => {
    const { token } = await makeAdminAndToken();
    const { data } = await callRoute<{ settings: { registrationOpen: boolean } }>(updateSettings, {
      method: "PATCH",
      body: { registrationOpen: false },
      cookies: { doma_session: token },
    });
    expect(data!.settings.registrationOpen).toBe(false);
  });

  it("updates trashRetentionDays", async () => {
    const { token } = await makeAdminAndToken();
    const { data } = await callRoute<{ settings: { trashRetentionDays: number } }>(updateSettings, {
      method: "PATCH",
      body: { trashRetentionDays: 7 },
      cookies: { doma_session: token },
    });
    expect(data!.settings.trashRetentionDays).toBe(7);
  });

  it("rejects trashRetentionDays > 3650", async () => {
    const { token } = await makeAdminAndToken();
    const { response } = await callRoute(updateSettings, {
      method: "PATCH",
      body: { trashRetentionDays: 5000 },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("updates multiple settings at once", async () => {
    const { token } = await makeAdminAndToken();
    const { data } = await callRoute<{ settings: { registrationOpen: boolean; trashRetentionDays: number } }>(updateSettings, {
      method: "PATCH",
      body: { registrationOpen: false, trashRetentionDays: 14 },
      cookies: { doma_session: token },
    });
    expect(data!.settings.registrationOpen).toBe(false);
    expect(data!.settings.trashRetentionDays).toBe(14);
  });
});

describe("POST /api/admin/recompute-quotas", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("recomputes usedBytes for all users", async () => {
    const { admin, token } = await makeAdminAndToken();
    // Create a file for the admin so usedBytes should be > 0.
    await seedFile({ ownerId: admin.id, parentId: null, name: "f.txt", sizeBytes: 500n });
    // Set a wrong cached value.
    await db.user.update({ where: { id: admin.id }, data: { usedBytes: 9999n } });
    const { response, data } = await callRoute<{ ok: boolean; recomputed: number; users: { id: string; before: string; after: string; drift: string }[] }>(recomputeQuotas, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.recomputed).toBe(1);
    expect(data!.users[0].after).toBe("500");
    expect(data!.users[0].drift).toBe("-9499"); // 500 - 9999
  });

  it("reports zero drift when the cached value is correct", async () => {
    const { admin, token } = await makeAdminAndToken();
    await seedFile({ ownerId: admin.id, parentId: null, name: "f.txt", sizeBytes: 100n });
    await db.user.update({ where: { id: admin.id }, data: { usedBytes: 100n } });
    const { data } = await callRoute<{ users: { drift: string }[] }>(recomputeQuotas, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(data!.users[0].drift).toBe("0");
  });
});
