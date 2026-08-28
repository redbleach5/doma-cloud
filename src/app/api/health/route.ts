import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Liveness / readiness for ops scripts (launchd WatchPaths, systemd, backups).
 * No auth — does not expose secrets, paths, or user data.
 *
 * 200 — process up and SQLite answers SELECT 1
 * 503 — process up but DB unreachable
 */
export async function GET() {
  try {
    await db.$queryRawUnsafe("SELECT 1");
    return NextResponse.json(
      { ok: true, db: "ok" },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: "error" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
