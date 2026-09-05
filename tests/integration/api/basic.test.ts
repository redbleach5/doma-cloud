import { describe, expect, it, beforeEach } from "bun:test";
import { GET as getMe } from "@/app/api/me/route";
import { GET as getSetupStatus } from "@/app/api/setup/status/route";
import { GET as getPublicSettings } from "@/app/api/public-settings/route";
import { db, resetDb, seedUser, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies, setMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";

describe("GET /api/me", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
  });

  it("returns { user: null } when not authenticated", async () => {
    const { response, data } = await callRoute<{ user: null }>(getMe, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.user).toBeNull();
  });

  it("returns the current user when authenticated", async () => {
    const u = await seedUser({ username: "alice", displayName: "Alice" });
    const token = await makeSessionToken(u);
    setMockCookies({ doma_session: token });

    const { response, data } = await callRoute<{ user: { id: string; username: string; displayName: string; role: string; quotaBytes: string; usedBytes: string } }>(getMe, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user).not.toBeNull();
    expect(data!.user!.id).toBe(u.id);
    expect(data!.user!.username).toBe("alice");
    expect(data!.user!.displayName).toBe("Alice");
    expect(data!.user!.role).toBe("user");
    // BigInt fields come back as strings.
    expect(typeof data!.user!.quotaBytes).toBe("string");
    expect(typeof data!.user!.usedBytes).toBe("string");
  });

  it("returns { user: null } when the session token is invalid", async () => {
    setMockCookies({ doma_session: "invalid-token" });
    const { response, data } = await callRoute<{ user: null }>(getMe, {
      method: "GET",
      cookies: { doma_session: "invalid-token" },
    });
    expect(response.status).toBe(200);
    expect(data!.user).toBeNull();
  });

  it("returns { user: null } when the user has been deleted", async () => {
    const u = await seedUser({ username: "alice" });
    const token = await makeSessionToken(u);
    await db.user.delete({ where: { id: u.id } });
    const { response, data } = await callRoute<{ user: null }>(getMe, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user).toBeNull();
  });

  it("returns { user: null } when tokenVersion doesn't match (password was changed)", async () => {
    const u = await seedUser({ username: "alice", tokenVersion: 0 });
    const token = await makeSessionToken(u); // token has ver: 0
    // Simulate a password change → tokenVersion incremented to 1.
    await db.user.update({ where: { id: u.id }, data: { tokenVersion: 1 } });
    const { response, data } = await callRoute<{ user: null }>(getMe, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user).toBeNull();
  });

  it("reflects the CURRENT role (not the one baked into the token)", async () => {
    const u = await seedUser({ username: "alice", role: "user" });
    const token = await makeSessionToken(u); // token has role: "user"
    // Admin promotes alice.
    await db.user.update({ where: { id: u.id }, data: { role: "admin" } });
    const { response, data } = await callRoute<{ user: { role: string } }>(getMe, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.user!.role).toBe("admin"); // reflects DB, not token
  });
});

describe("GET /api/setup/status", () => {
  beforeEach(async () => {
    await resetDb();
    __clearRateLimitBucketsForTests();
  });

  it("returns needsSetup=true when no users exist", async () => {
    const { response, data } = await callRoute<{ needsSetup: boolean; userCount: number }>(getSetupStatus, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.needsSetup).toBe(true);
    expect(data!.userCount).toBe(0);
  });

  it("returns needsSetup=false when at least one user exists", async () => {
    await seedUser({ username: "admin", role: "admin" });
    const { response, data } = await callRoute<{ needsSetup: boolean; userCount: number }>(getSetupStatus, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.needsSetup).toBe(false);
    expect(data!.userCount).toBe(1);
  });

  it("returns the correct userCount for multiple users", async () => {
    await seedUser({ username: "a" });
    await seedUser({ username: "b" });
    await seedUser({ username: "c" });
    const { data } = await callRoute<{ userCount: number }>(getSetupStatus, { method: "GET" });
    expect(data!.userCount).toBe(3);
  });

  it("does not require authentication", async () => {
    // No cookies set — should still work.
    const { response } = await callRoute(getSetupStatus, { method: "GET" });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/public-settings", () => {
  beforeEach(async () => {
    await resetDb();
    __clearRateLimitBucketsForTests();
  });

  it("returns registrationOpen=true by default", async () => {
    const { response, data } = await callRoute<{ registrationOpen: boolean }>(getPublicSettings, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.registrationOpen).toBe(true);
  });

  it("returns registrationOpen=false when the setting is disabled", async () => {
    await db.setting.create({ data: { key: "registrationOpen", value: "false" } });
    const { response, data } = await callRoute<{ registrationOpen: boolean }>(getPublicSettings, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.registrationOpen).toBe(false);
  });

  it("only exposes registrationOpen (not other settings)", async () => {
    // Set all four settings.
    await db.setting.create({ data: { key: "defaultQuotaBytes", value: "123" } });
    await db.setting.create({ data: { key: "adminQuotaBytes", value: "456" } });
    await db.setting.create({ data: { key: "trashRetentionDays", value: "7" } });
    const { response, data } = await callRoute<{ registrationOpen: boolean; defaultQuotaBytes?: unknown; adminQuotaBytes?: unknown }>(getPublicSettings, { method: "GET" });
    expect(response.status).toBe(200);
    expect(data!.registrationOpen).toBe(true); // default
    // Must NOT leak admin-only settings.
    expect(data!.defaultQuotaBytes).toBeUndefined();
    expect(data!.adminQuotaBytes).toBeUndefined();
  });

  it("does not require authentication", async () => {
    const { response } = await callRoute(getPublicSettings, { method: "GET" });
    expect(response.status).toBe(200);
  });
});
