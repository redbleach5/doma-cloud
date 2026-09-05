import { describe, expect, it } from "bun:test";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("hashPassword / verifyPassword (argon2id)", () => {
  it("hashes a password and verifies it against the original", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    const ok = await verifyPassword("correct horse battery staple", hash);
    expect(ok).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("hunter2");
    const ok = await verifyPassword("nope", hash);
    expect(ok).toBe(false);
  });

  it("produces a different hash for the same password (salt is random)", async () => {
    const h1 = await hashPassword("same-password");
    const h2 = await hashPassword("same-password");
    expect(h1).not.toBe(h2); // different salts
    // Both should still verify against the plaintext.
    expect(await verifyPassword("same-password", h1)).toBe(true);
    expect(await verifyPassword("same-password", h2)).toBe(true);
  });

  it("handles empty passwords", async () => {
    const hash = await hashPassword("");
    expect(await verifyPassword("", hash)).toBe(true);
    expect(await verifyPassword("x", hash)).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const pw = "пароль-123-🔐";
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
    expect(await verifyPassword("пароль-123-🔑", hash)).toBe(false);
  });

  it("handles long passwords (up to 200 chars, the schema max)", async () => {
    const pw = "a".repeat(200);
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
  });

  it("verifyPassword returns false (not throw) for a malformed hash", async () => {
    // The implementation catches errors from argon2 and returns false.
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "$argon2id$malformed")).toBe(false);
  });

  it("verifyPassword returns false for a hash with wrong algorithm prefix", async () => {
    // A bcrypt-style hash should not verify through argon2.
    const fakeHash = "$2b$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV12345678901234567890123456789012";
    expect(await verifyPassword("anything", fakeHash)).toBe(false);
  });
});
