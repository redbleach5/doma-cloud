import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Returns the current admin user, or a 403 response. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Требуются права администратора" },
      { status: 403 }
    );
  }
  return { user, session };
}

export type AdminGuard = Awaited<ReturnType<typeof requireAdmin>>;
