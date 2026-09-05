import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Read the cached `usedBytes` column — maintained incrementally by the
  // upload/delete/restore routes. Avoids an O(N) tree traversal on every
  // /api/me call (which fires on every page navigation and tab focus).
  // If you suspect drift, hit POST /api/admin/recompute-quotas to recompute.
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
      usedBytes: user.usedBytes.toString(),
      createdAt: user.createdAt,
    },
  });
}
