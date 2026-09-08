import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import {
  rateLimit,
  getClientIp,
  LIMITS,
} from "@/lib/auth/rate-limit";

// The rate limiter uses an in-memory Map. State persists across tests in the
// same process, so we use unique keys per test to avoid interference.

describe("rateLimit", () => {
  it("allows the first request in a fresh bucket", () => {
    const key = `test-fresh-${Math.random()}`;
    const result = rateLimit(key, 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it("counts down remaining as more requests come in", () => {
    const key = `test-countdown-${Math.random()}`;
    const r1 = rateLimit(key, 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    const r2 = rateLimit(key, 3, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
    const r3 = rateLimit(key, 3, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests once the limit is exceeded", () => {
    const key = `test-block-${Math.random()}`;
    // Fill the bucket (limit = 2)
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    // Third request should be blocked
    const r = rateLimit(key, 2, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("never returns a negative remaining count", () => {
    const key = `test-negative-${Math.random()}`;
    rateLimit(key, 1, 60_000);
    rateLimit(key, 1, 60_000);
    rateLimit(key, 1, 60_000);
    rateLimit(key, 1, 60_000);
    const r = rateLimit(key, 1, 60_000);
    expect(r.remaining).toBe(0); // never negative
  });

  it("treats different keys as independent buckets", () => {
    const keyA = `test-indep-a-${Math.random()}`;
    const keyB = `test-indep-b-${Math.random()}`;
    const rA = rateLimit(keyA, 1, 60_000);
    const rB = rateLimit(keyB, 1, 60_000);
    expect(rA.allowed).toBe(true);
    expect(rB.allowed).toBe(true);
    // keyA is now exhausted, keyB is not
    const rA2 = rateLimit(keyA, 1, 60_000);
    const rB2 = rateLimit(keyB, 1, 60_000);
    expect(rA2.allowed).toBe(false);
    expect(rB2.allowed).toBe(false); // rB2 used the second slot of keyB
    const rB3 = rateLimit(keyB, 1, 60_000);
    expect(rB3.allowed).toBe(false);
  });

  it("creates a fresh bucket once the window expires", async () => {
    const key = `test-expire-${Math.random()}`;
    // Window of 50ms
    const r1 = rateLimit(key, 1, 50);
    expect(r1.allowed).toBe(true);
    const r2 = rateLimit(key, 1, 50);
    expect(r2.allowed).toBe(false);
    // Wait for the window to expire
    await new Promise((r) => setTimeout(r, 80));
    const r3 = rateLimit(key, 1, 50);
    expect(r3.allowed).toBe(true);
  });

  it("returns a resetAt in the future", () => {
    const key = `test-reset-${Math.random()}`;
    const before = Date.now();
    const r = rateLimit(key, 5, 60_000);
    const after = Date.now();
    expect(r.resetAt).toBeGreaterThanOrEqual(before + 60_000 - 5);
    expect(r.resetAt).toBeLessThanOrEqual(after + 60_000 + 5);
  });

  it("LIMITS contains sane values for each action", () => {
    expect(LIMITS.login.limit).toBeGreaterThan(0);
    expect(LIMITS.login.windowMs).toBeGreaterThan(0);
    expect(LIMITS.register.limit).toBeGreaterThan(0);
    expect(LIMITS.shareVerify.limit).toBeGreaterThan(0);
    expect(LIMITS.upload.limit).toBeGreaterThan(0);
    expect(LIMITS.download.limit).toBeGreaterThan(0);
    // Login should be more restrictive than download (brute-force vs scraping)
    expect(LIMITS.login.limit).toBeLessThan(LIMITS.download.limit);
  });
});

describe("getClientIp", () => {
  const prevHops = process.env.TRUSTED_PROXY_HOPS;

  // Bun auto-loads the repo's .env (TRUSTED_PROXY_HOPS=0 for this LAN-first
  // deployment), which would make the header-based cases below fail. Pin the
  // default trust model explicitly so these tests are deterministic.
  beforeEach(() => {
    process.env.TRUSTED_PROXY_HOPS = "1";
  });

  afterAll(() => {
    if (prevHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = prevHops;
  });

  it("returns the first IP from X-Forwarded-For", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("trims whitespace around the IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("handles a single IP in X-Forwarded-For", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("prefers X-Forwarded-For over X-Real-IP", () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      },
    });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });

  it("ignores X-Forwarded-For entirely when hops=0 (no proxy in front)", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("unknown");
  });

  it("takes the Nth-from-the-right entry when hops>1 (RFC 7239 append mode)", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "0.0.0.0, 1.2.3.4, 5.6.7.8" },
    });
    // client → cloudflare → nginx → app: the 2nd-from-the-right is the client.
    expect(getClientIp(req)).toBe("1.2.3.4");
  });
});
