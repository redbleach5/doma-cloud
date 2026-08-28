import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSession,
  invalidateUserSessions,
} from "@/lib/auth/session";

/**
 * Logout — clears the session cookie AND invalidates ALL server-side
 * sessions for the user by bumping their `tokenVersion`.
 *
 * Previously this only cleared the cookie on the client. The JWT itself
 * remained valid (signed, up to 30 days TTL) — so a stolen cookie
 * (XSS, device compromise, log exfiltration) kept working after the
 * user clicked "Log out". Server-side invalidation closes that window.
 *
 * Trade-off: this logs the user out of ALL their devices/tabs, not just
 * the current one. That's the desired behaviour for logout.
 */
export async function POST() {
  const session = await getSession();
  if (session) {
    await invalidateUserSessions(session.sub);
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
