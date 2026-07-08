import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { computeDirectorySize } from "@/lib/cloud/tree";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Recompute used space — accurate but cheap enough on a family scale.
  const usedBytes = await computeDirectorySize(user.id, null);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      quotaBytes: user.quotaBytes.toString(),
      usedBytes: usedBytes.toString(),
      createdAt: user.createdAt,
    },
  });
}
