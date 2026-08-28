import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";

/**
 * GET /api/users/search?q=<prefix>
 *
 * Used by the share dialog to pick recipients.
 *
 * - Empty `q`: list all other household accounts (family roster). Cap 50 —
 *   this is a family cloud, not a public directory.
 * - Non-empty `q`: case-insensitive username prefix search (limit 10).
 *
 * Always excludes the caller. Rate-limited.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const rl = rateLimit(`user-search:${session.sub}`, LIMITS.userSearch.limit, LIMITS.userSearch.windowMs);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (q.length < 1) {
    const rows = await db.user.findMany({
      where: { id: { not: session.sub } },
      select: { id: true, username: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 50,
    });
    return NextResponse.json({ users: rows });
  }

  // Case-insensitive prefix search via lower().
  const rows = await db.$queryRaw<
    Array<{ id: string; username: string; displayName: string }>
  >`
    SELECT id, username, displayName
    FROM User
    WHERE lower(username) LIKE lower(${q + "%"})
      AND id != ${session.sub}
    LIMIT 10
  `;

  return NextResponse.json({ users: rows });
}
