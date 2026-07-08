import { NextRequest, NextResponse } from "next/server";

/**
 * Doma Cloud middleware.
 *
 * Runs on every request (Edge runtime). Handles:
 *   - Security headers (CSP, X-Frame-Options, etc.)
 *   - Share-page no-cache headers (prevents browser/proxy caching of /s/*)
 *
 * Note: Rate limiting is done per-route (src/lib/auth/rate-limit.ts) because
 * middleware runs on Edge and can't access the in-memory limiter. For a
 * multi-instance deployment, move rate limiting to a Redis-backed middleware.
 */

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // ---- Security headers ----
  // Prevent clickjacking — Doma should never be embedded in an iframe.
  res.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME-type sniffing.
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Referrer policy — only send origin to same-origin, strip for cross-origin.
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions policy — disable camera/mic/geolocation access (not needed).
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );

  // ---- Share-page cache prevention ----
  // Share pages must never be cached by the browser or a CDN — they may
  // contain sensitive file metadata and the share may expire or be revoked.
  const pathname = _req.nextUrl.pathname;
  if (pathname.startsWith("/s/")) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
  }

  return res;
}

export const config = {
  // Run on all routes except static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-.*\\.png|manifest\\.webmanifest|sw\\.js|robots\\.txt).*)",
  ],
};
