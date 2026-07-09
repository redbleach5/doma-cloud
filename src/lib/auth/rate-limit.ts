/**
 * Simple in-memory rate limiter.
 *
 * For a family-scale deployment this is sufficient — no Redis needed.
 * Each bucket is identified by a key (typically IP + action) and tracks
 * the number of hits in a sliding window.
 *
 * Limits are deliberately generous for legit family use but block brute
 * force (e.g. share password guessing, login credential stuffing).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically purge expired buckets to avoid memory growth.
let lastPurge = Date.now();
function purgeIfStale() {
  const now = Date.now();
  if (now - lastPurge < 60_000) return;
  lastPurge = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check + consume one unit from the bucket.
 *
 * @param key     Unique identifier (e.g. `${ip}:login`)
 * @param limit   Max hits per window
 * @param windowMs Window size in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  purgeIfStale();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    // Fresh bucket.
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Extract client IP from a Next.js request (handles X-Forwarded-For). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// Pre-configured limits for common actions.
export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },         // 10 attempts/min per IP
  register: { limit: 5, windowMs: 60_000 },        // 5 registrations/min per IP
  shareVerify: { limit: 20, windowMs: 60_000 },    // 20 password attempts/min per IP+share
  upload: { limit: 100, windowMs: 60_000 },         // 100 uploads/min per user
  download: { limit: 200, windowMs: 60_000 },       // 200 downloads/min per IP (incl. Range)
} as const;

/**
 * TEST-ONLY: clear all rate-limit buckets. Used by test setup to ensure
 * tests don't interfere with each other via shared in-memory state.
 * Not intended for production use.
 */
export function __clearRateLimitBucketsForTests(): void {
  buckets.clear();
  lastPurge = Date.now();
}
