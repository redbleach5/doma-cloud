/**
 * Lightweight JWT auth — no NextAuth overhead, just httpOnly cookies.
 *
 * Sessions are signed with DOMA_JWT_SECRET. Tokens carry { sub, username, role, ver }.
 *
 * `ver` is the user's `tokenVersion` from the DB. When the user changes their
 * password (or an admin resets it), `tokenVersion` is incremented, invalidating
 * all previously-issued tokens. `getSession()` verifies `ver` against the DB
 * on every call — this prevents stale sessions after a password change.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
} from "./password";

// Re-export so existing callers (`import { hashPassword } from "@/lib/auth/session"`)
export { hashPassword, verifyPassword };

const COOKIE_NAME = "doma_session";
// Session TTL in seconds. Override via DOMA_SESSION_TTL_SECONDS.
// Default: 30 days (60 * 60 * 24 * 30).
const TOKEN_TTL_SECONDS = Number(process.env.DOMA_SESSION_TTL_SECONDS) || 60 * 60 * 24 * 30;

/** Cached ephemeral secret for DOMA_DEV=1 — must be stable within the process
 *  so signSession/verifySession (and cookies) use the same key. */
let ephemeralDevSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  const raw = process.env.DOMA_JWT_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DOMA_JWT_SECRET is not set. Refusing to start in production with a predictable secret.\n" +
          "Generate one with: openssl rand -base64 48\n" +
          "Then set it in your .env file."
      );
    }
    // Require explicit opt-in for the dev fallback so a misconfigured
    // NODE_ENV never silently activates a predictable secret.
    if (process.env.DOMA_DEV !== "1") {
      throw new Error(
        "DOMA_JWT_SECRET is not set. In development, set DOMA_DEV=1 to allow\n" +
          "an ephemeral per-process secret (sessions reset on restart)."
      );
    }
    if (!ephemeralDevSecret) {
      ephemeralDevSecret = new TextEncoder().encode(
        "doma-dev-secret-" + process.cwd() + "-" + Math.random()
      );
      console.warn("[auth] DOMA_JWT_SECRET not set + DOMA_DEV=1: using ephemeral dev secret (DEV ONLY).");
    }
    return ephemeralDevSecret;
  }
  // Reject placeholder values copied verbatim from .env.example — these are
  // documented defaults that must be replaced before deployment.
  if (raw === "replace-me-with-a-strong-random-secret-please") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DOMA_JWT_SECRET is still the .env.example placeholder. Refusing to start.\n" +
          "Generate a real secret: openssl rand -base64 48"
      );
    }
    console.warn("[auth] DOMA_JWT_SECRET is the .env.example placeholder — replace it before production.");
  }
  if (raw.length < 32) {
    console.warn(
      `[auth] DOMA_JWT_SECRET is only ${raw.length} chars. Recommend ≥ 32 chars (run: openssl rand -base64 48).`
    );
  }
  return new TextEncoder().encode(raw);
}

export interface SessionPayload {
  sub: string;
  username: string;
  role: "admin" | "user";
  ver: number;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setSubject(payload.sub)
    .sign(getSecret());
}

/** Verify JWT signature + expiry. Does NOT check tokenVersion (use getSession for that). */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    return {
      sub: payload.sub as string,
      username: payload.username as string,
      role: payload.role as "admin" | "user",
      ver: (payload.ver as number) ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Read the current session from the request cookies (server-side).
 *
 * Verifies the JWT signature AND checks tokenVersion against the DB — if the
 * user changed their password after this token was issued, the session is
 * treated as invalid (returns null).
 *
 * The DB check adds ~1ms per request on SQLite, which is negligible for
 * family-scale use.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload) return null;

  // Check tokenVersion against DB — invalidates old sessions after password change.
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { tokenVersion: true, role: true },
  });
  if (!user) return null; // user deleted

  // If tokenVersion doesn't match, the token was issued before a password change.
  if (user.tokenVersion !== payload.ver) return null;

  // Return the payload with the CURRENT role (in case it was changed in DB).
  return { ...payload, role: user.role as "admin" | "user" };
}

/** Set the session cookie on a response. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.DOMA_INSECURE_COOKIE !== "1",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Invalidate all sessions for a user by incrementing their tokenVersion.
 * Call this after password change / admin password reset.
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL = TOKEN_TTL_SECONDS;
