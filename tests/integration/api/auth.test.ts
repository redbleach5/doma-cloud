import { describe, expect, it, beforeEach } from "bun:test";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as listFiles } from "@/app/api/files/list/route";
import { db, resetDb, seedUser, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import {
  resetMockCookies,
  setMockCookies,
  getMockCookie,
} from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";

describe("POST /api/auth/register", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
  });

  it("rejects invalid JSON body", async () => {
    const { response, data } = await callRoute(register, {
      method: "POST",
      rawBody: "not json{",
      contentType: "application/json",
    });
    expect(response.status).toBe(400);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("rejects missing fields (validation error)", async () => {
    const { response, data } = await callRoute(register, {
      method: "POST",
      body: { username: "ab" }, // too short, no password
    });
    expect(response.status).toBe(422);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("rejects a username shorter than 3 chars", async () => {
    const { response } = await callRoute(register, {
      method: "POST",
      body: { username: "ab", password: "password123" },
    });
    expect(response.status).toBe(422);
  });

  it("rejects a password shorter than 6 chars", async () => {
    const { response } = await callRoute(register, {
      method: "POST",
      body: { username: "alice", password: "12345" },
    });
    expect(response.status).toBe(422);
  });

  it("rejects invalid characters in username", async () => {
    const { response } = await callRoute(register, {
      method: "POST",
      body: { username: "alice@home", password: "password123" },
    });
    expect(response.status).toBe(422);
  });

  it("registers the first user as admin with adminQuotaBytes", async () => {
    const { response, data } = await callRoute<{ user: { role: string; quotaBytes: string }; isFirstUser: boolean }>(register, {
      method: "POST",
      body: { username: "alice", password: "password123", displayName: "Alice" },
    });
    expect(response.status).toBe(200);
    expect(data!.isFirstUser).toBe(true);
    expect(data!.user.role).toBe("admin");
    // Default adminQuotaBytes is 3 TB
    expect(BigInt(data!.user.quotaBytes)).toBe(3n * 1024n * 1024n * 1024n * 1024n);
  });

  it("registers subsequent users as 'user' role with defaultQuotaBytes", async () => {
    // First user (admin)
    await callRoute(register, {
      method: "POST",
      body: { username: "admin", password: "password123" },
    });
    resetMockCookies();
    // Second user
    const { response, data } = await callRoute<{ user: { role: string; quotaBytes: string }; isFirstUser: boolean }>(register, {
      method: "POST",
      body: { username: "bob", password: "password123" },
    });
    expect(response.status).toBe(200);
    expect(data!.isFirstUser).toBe(false);
    expect(data!.user.role).toBe("user");
    // Default defaultQuotaBytes is 50 GB
    expect(BigInt(data!.user.quotaBytes)).toBe(50n * 1024n * 1024n * 1024n);
  });

  it("sets the session cookie after successful registration", async () => {
    await callRoute(register, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    const cookie = getMockCookie("doma_session");
    expect(cookie).toBeDefined();
    expect(typeof cookie).toBe("string");
    expect(cookie!.split(".").length).toBe(3); // JWT structure
  });

  it("rejects an exact duplicate username", async () => {
    await seedUser({ username: "alice", password: "password123" });
    const { response, data } = await callRoute(register, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    expect(response.status).toBe(409);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("rejects cross-case duplicate usernames", async () => {
    await seedUser({ username: "Alice", password: "password123" });
    const { response } = await callRoute(register, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    expect(response.status).toBe(409);
  });

  it("respects the registrationOpen=false setting (after first user)", async () => {
    // Create one user so registrationOpen takes effect.
    await seedUser({ username: "firstadmin", role: "admin" });
    // Disable registration.
    await db.setting.create({
      data: { key: "registrationOpen", value: "false" },
    });
    const { response, data } = await callRoute(register, {
      method: "POST",
      body: { username: "newbie", password: "password123" },
    });
    expect(response.status).toBe(403);
    expect(data).toMatchObject({ error: expect.stringMatching(/регистраци/i) });
  });

  it("allows registration when registrationOpen=true (default)", async () => {
    await seedUser({ username: "firstadmin", role: "admin" });
    const { response } = await callRoute(register, {
      method: "POST",
      body: { username: "newbie", password: "password123" },
    });
    expect(response.status).toBe(200);
  });

  it("rate-limits after 5 registration attempts per minute", async () => {
    // Use a constant IP via X-Forwarded-For to ensure same rate-limit bucket.
    const ip = "10.0.0.99";
    for (let i = 0; i < 5; i++) {
      await callRoute(register, {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { username: `user${i}`, password: "password123" },
      });
    }
    // 6th attempt should be rate-limited.
    const { response, data } = await callRoute(register, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: { username: "user6", password: "password123" },
    });
    expect(response.status).toBe(429);
    expect(data).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
  });

  it("rejects invalid JSON body", async () => {
    const { response } = await callRoute(login, {
      method: "POST",
      rawBody: "{invalid",
      contentType: "application/json",
    });
    expect(response.status).toBe(400);
  });

  it("rejects missing fields (validation error)", async () => {
    const { response } = await callRoute(login, {
      method: "POST",
      body: { username: "" },
    });
    expect(response.status).toBe(422);
  });

  it("returns 401 for a non-existent user", async () => {
    const { response, data } = await callRoute(login, {
      method: "POST",
      body: { username: "ghost", password: "password123" },
    });
    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("returns 401 for an incorrect password", async () => {
    await seedUser({ username: "alice", password: "correct-password" });
    const { response, data } = await callRoute(login, {
      method: "POST",
      body: { username: "alice", password: "wrong-password" },
    });
    expect(response.status).toBe(401);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("logs in successfully with correct credentials", async () => {
    await seedUser({ username: "alice", password: "password123", displayName: "Alice" });
    const { response, data } = await callRoute<{ user: { username: string; displayName: string } }>(login, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    expect(response.status).toBe(200);
    expect(data!.user.username).toBe("alice");
    expect(data!.user.displayName).toBe("Alice");
  });

  it("sets the session cookie after successful login", async () => {
    await seedUser({ username: "alice", password: "password123" });
    await callRoute(login, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    expect(getMockCookie("doma_session")).toBeDefined();
  });

  it("updates lastLoginAt on successful login", async () => {
    const u = await seedUser({ username: "alice", password: "password123" });
    expect(u.lastLoginAt).toBeNull(); // seedUser doesn't set it
    await callRoute(login, {
      method: "POST",
      body: { username: "alice", password: "password123" },
    });
    // Wait a moment for the fire-and-forget update to complete.
    await new Promise((r) => setTimeout(r, 50));
    const refreshed = await db.user.findUnique({ where: { id: u.id } });
    expect(refreshed?.lastLoginAt).not.toBeNull();
  });

  it("accepts username case-insensitively (lowercase lookup)", async () => {
    // Register with lowercase, login with uppercase. The login route does:
    //   1. findUnique({ where: { username } }) — exact match, fails for "ALICE"
    //   2. findFirst({ where: { username: username.toLowerCase() } }) — finds "alice"
    await seedUser({ username: "alice", password: "password123" });
    const { response } = await callRoute(login, {
      method: "POST",
      body: { username: "ALICE", password: "password123" },
    });
    expect(response.status).toBe(200);
  });

  it("rate-limits after 10 login attempts per minute", async () => {
    const ip = "10.0.0.50";
    for (let i = 0; i < 10; i++) {
      await callRoute(login, {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: { username: "ghost", password: "wrong" },
      });
    }
    const { response } = await callRoute(login, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: { username: "ghost", password: "wrong" },
    });
    expect(response.status).toBe(429);
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
  });

  it("clears the session cookie", async () => {
    const user = await seedUser({ username: "alice" });
    const sessionToken = await makeSessionToken(user);
    setMockCookies({ doma_session: sessionToken });
    const { response, data } = await callRoute<{ ok: boolean }>(logout, {
      method: "POST",
      cookies: { doma_session: sessionToken },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(getMockCookie("doma_session")).toBeUndefined();
  });

  it("invalidates the session token server-side (tokenVersion bump)", async () => {
    const user = await seedUser({ username: "bob" });
    const sessionToken = await makeSessionToken(user);

    const before = await callRoute(listFiles, {
      cookies: { doma_session: sessionToken },
    });
    expect(before.response.status).toBe(200);

    await callRoute(logout, {
      method: "POST",
      cookies: { doma_session: sessionToken },
    });

    const after = await callRoute(listFiles, {
      cookies: { doma_session: sessionToken },
    });
    expect(after.response.status).toBe(401);
  });

  it("works even when no session cookie was set", async () => {
    const { response, data } = await callRoute<{ ok: boolean }>(logout, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
  });
});
