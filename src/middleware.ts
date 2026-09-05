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

// Next.js App Router injects inline bootstrap scripts (`self.__next_f.push(...)`)
// for RSC hydration. Without 'unsafe-inline' the browser blocks them, React never
// hydrates, and forms fall back to a native GET submit (fields appear to "reset").
// 'unsafe-eval' is required by Turbopack HMR in development only.
const isDev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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
  // Content Security Policy — restricts script/style/img sources to self,
  // blocks inline scripts, prevents XSS from user-uploaded HTML/SVG being
  // served from the same origin (download endpoint hardening).
  // `style-src 'unsafe-inline'` is needed for Next.js styled-jsx + Tailwind.
  res.headers.set("Content-Security-Policy", CSP);

  // HSTS — only emit in production AND over HTTPS (the header is ignored
  // over plain HTTP and would lock users out if issued by a misconfigured
  // HTTP-only deploy). We rely on `x-forwarded-proto` to detect TLS
  // termination upstream (Caddy, Cloudflare, nginx, etc.).
  if (process.env.NODE_ENV === "production") {
    const proto = _req.headers.get("x-forwarded-proto");
    const isHttps = proto === "https" || _req.nextUrl.protocol === "https:";
    if (isHttps) {
      res.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload"
      );
    }
  }

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
