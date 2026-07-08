import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const userCount = await db.user.count();
  return NextResponse.json({
    needsSetup: userCount === 0,
    userCount,
  });
}
