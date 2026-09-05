/**
 * Constant-time comparison helper for secret-valued headers and tokens.
 *
 * The naive `providedSecret !== expectedSecret` pattern is vulnerable to
 * timing attacks: an attacker measures response time byte-by-byte and
 * gradually reconstructs the secret. Network jitter makes this hard but
 * not impossible, and the fix is cheap — so we always use `timingSafeEqual`.
 */
import { timingSafeEqual } from "node:crypto";

export function safeSecretCompare(provided: string | null | undefined, expected: string): boolean {
  const a = Buffer.from(provided ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    try { timingSafeEqual(b, b); } catch { /* defensive */ }
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
