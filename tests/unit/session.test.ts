import { describe, expect, it, afterEach } from "bun:test";
import { signSession, verifySession } from "@/lib/auth/session";

// These tests exercise signSession and verifySession directly, WITHOUT going
// through the cookie store. The cookie-dependent getSession/setSessionCookie
// functions are tested via the API route tests (which use the mock-cookies
// helper).

const ORIGINAL_JWT_SECRET = process.env.DOMA_JWT_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("signSession / verifySession (JWT)", () => {
  afterEach(() => {
    // Restore env so tests don't leak state into each other.
    if (ORIGINAL_JWT_SECRET !== undefined) {
      process.env.DOMA_JWT_SECRET = ORIGINAL_JWT_SECRET;
    } else {
      delete process.env.DOMA_JWT_SECRET;
    }
    process.env.NODE_ENV = ORIGINAL_NODE_ENV ?? "test";
  });

  it("signs and verifies a valid session token", async () => {
    process.env.DOMA_JWT_SECRET = "test-secret-32+chars-long-for-signing-ok";
    const payload = {
      sub: "user-1",
      username: "alice",
      role: "admin" as const,
      ver: 0,
    };
    const token = await signSession(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3); // header.payload.signature

    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("user-1");
    expect(verified!.username).toBe("alice");
    expect(verified!.role).toBe("admin");
    expect(verified!.ver).toBe(0);
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.DOMA_JWT_SECRET = "secret-one-32+chars-long-for-signing-ok";
    const token = await signSession({
      sub: "u1", username: "a", role: "user", ver: 0,
    });
    // Switch to a different secret — verification should fail.
    process.env.DOMA_JWT_SECRET = "secret-two-32+chars-long-for-signing-ok";
    const verified = await verifySession(token);
    expect(verified).toBeNull();
  });

  it("rejects a malformed token string", async () => {
    process.env.DOMA_JWT_SECRET = "test-secret-32+chars-long-for-signing-ok";
    expect(await verifySession("not-a-jwt")).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("a.b.c")).toBeNull(); // 3 parts but invalid base64
  });

  it("rejects an expired token", async () => {
    process.env.DOMA_JWT_SECRET = "test-secret-32+chars-long-for-signing-ok";
    // Sign with a very short TTL by manually constructing an expired JWT.
    // We can't easily pass a custom TTL through signSession, so we craft one
    // with jose directly.
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.DOMA_JWT_SECRET);
    const expired = await new SignJWT({ sub: "u1", username: "a", role: "user", ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("0s") // already expired
      .setSubject("u1")
      .sign(secret);
    // Wait a moment to ensure the token is past expiry.
    await new Promise((r) => setTimeout(r, 50));
    expect(await verifySession(expired)).toBeNull();
  });

  it("preserves the role field as 'admin' or 'user'", async () => {
    process.env.DOMA_JWT_SECRET = "test-secret-32+chars-long-for-signing-ok";
    for (const role of ["admin", "user"] as const) {
      const token = await signSession({
        sub: "u", username: "x", role, ver: 1,
      });
      const v = await verifySession(token);
      expect(v!.role).toBe(role);
    }
  });

  it("preserves the tokenVersion (ver) field", async () => {
    process.env.DOMA_JWT_SECRET = "test-secret-32+chars-long-for-signing-ok";
    for (const ver of [0, 1, 42, 1000]) {
      const token = await signSession({
        sub: "u", username: "x", role: "user", ver,
      });
      const v = await verifySession(token);
      expect(v!.ver).toBe(ver);
    }
  });
});

describe("getSecret behavior (via signSession)", () => {
  // These test the secret-loading logic indirectly. signSession calls
  // getSecret() internally; if the secret is the .env.example placeholder in
  // production, it throws. Ephemeral fallback requires DOMA_DEV=1.
  const ORIGINAL_JWT_SECRET = process.env.DOMA_JWT_SECRET;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DOMA_DEV = process.env.DOMA_DEV;

  afterEach(() => {
    if (ORIGINAL_JWT_SECRET !== undefined) {
      process.env.DOMA_JWT_SECRET = ORIGINAL_JWT_SECRET;
    } else {
      delete process.env.DOMA_JWT_SECRET;
    }
    process.env.NODE_ENV = ORIGINAL_NODE_ENV ?? "test";
    if (ORIGINAL_DOMA_DEV !== undefined) {
      process.env.DOMA_DEV = ORIGINAL_DOMA_DEV;
    } else {
      delete process.env.DOMA_DEV;
    }
  });

  it("signs successfully with no secret when DOMA_DEV=1 (ephemeral secret)", async () => {
    delete process.env.DOMA_JWT_SECRET;
    process.env.NODE_ENV = "test";
    process.env.DOMA_DEV = "1";
    const token = await signSession({
      sub: "u", username: "x", role: "user", ver: 0,
    });
    expect(typeof token).toBe("string");
    const v = await verifySession(token);
    expect(v).not.toBeNull();
  });

  it("throws in non-production if secret is missing and DOMA_DEV is not set", async () => {
    delete process.env.DOMA_JWT_SECRET;
    delete process.env.DOMA_DEV;
    process.env.NODE_ENV = "test";
    await expect(
      signSession({ sub: "u", username: "x", role: "user", ver: 0 })
    ).rejects.toThrow(/DOMA_DEV=1/);
  });

  it("throws in production mode if DOMA_JWT_SECRET is not set", async () => {
    delete process.env.DOMA_JWT_SECRET;
    process.env.NODE_ENV = "production";
    await expect(
      signSession({ sub: "u", username: "x", role: "user", ver: 0 })
    ).rejects.toThrow(/DOMA_JWT_SECRET/);
  });

  it("throws in production mode if DOMA_JWT_SECRET is the .env.example placeholder", async () => {
    process.env.DOMA_JWT_SECRET = "replace-me-with-a-strong-random-secret-please";
    process.env.NODE_ENV = "production";
    await expect(
      signSession({ sub: "u", username: "x", role: "user", ver: 0 })
    ).rejects.toThrow(/placeholder/);
  });
});
