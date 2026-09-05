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

/**
 * Extract client IP from a Next.js request.
 *
 * Trust model:
 *   - `TRUSTED_PROXY_HOPS` env var: how many proxies sit between the client
 *     and us. Defaults to 1 (the documented Caddy deployment).
 *   - With `hops=1` we take the first entry of X-Forwarded-For (Caddy's
 *     `header_up X-Forwarded-For {remote_host}` REPLACES the header with
 *     a single value, so the first entry IS the real client).
 *   - With `hops>1` we take the Nth-from-the-right entry (RFC 7239 append
 *     mode, e.g. Cloudflare → nginx → app). Entries before that came from
 *     the client and must NOT be trusted.
 *   - With `hops=0` we ignore X-Forwarded-For entirely (app exposed
 *     directly, no proxy in front).
 */
export function getClientIp(req: Request): string {
  const hopsRaw = parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
  const hops = Number.isFinite(hopsRaw) && hopsRaw >= 0 ? hopsRaw : 1;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && hops > 0) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      if (hops === 1) {
        return parts[0] ?? "unknown";
      }
      const idx = Math.max(0, parts.length - hops);
      return parts[idx] ?? "unknown";
    }
  }

  if (hops > 0) {
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }

  return "unknown";
}

// Pre-configured limits for common actions.
export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },         // 10 attempts/min per IP
  register: { limit: 5, windowMs: 60_000 },        // 5 registrations/min per IP
  shareVerify: { limit: 20, windowMs: 60_000 },    // 20 password attempts/min per IP+share
  shareCreate: { limit: 10, windowMs: 60_000 },    // 10 link-shares/min per user
  userSearch: { limit: 30, windowMs: 60_000 },     // 30 user-searches/min per user
  upload: { limit: 100, windowMs: 60_000 },         // 100 multipart uploads/min per user
  // Chunk POSTs are frequent for large files (5 MB × N). Keep them on a
  // separate bucket so a single 100 GB upload is not killed by the
  // multipart limit after ~100 chunks (~8 minutes of progress wasted).
  uploadChunk: { limit: 600, windowMs: 60_000 },    // 600 chunks/min ≈ 3 GB/min theoretically
  download: { limit: 200, windowMs: 60_000 },       // 200 downloads/min per IP (incl. Range)
  // Thumbnails are fetched in parallel bursts when a big folder opens
  // (browser issues one <img> request per visible card). Sharing the
  // `download` bucket made 429s cascade through the grid. Separate,
  // generous bucket so previews never starve real downloads.
  thumbnail: { limit: 900, windowMs: 60_000 },      // 900 thumbnails/min per IP
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
