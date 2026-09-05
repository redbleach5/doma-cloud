import { NextResponse } from "next/server";
import { getAllSettings } from "@/lib/cloud/settings";

/**
 * Public endpoint — returns only the settings that affect anonymous OR
 * authenticated users but are NOT sensitive (i.e. safe to expose without
 * admin auth).
 *
 * No auth required. Returns:
 *   - registrationOpen: boolean       — controls whether the login screen
 *                                       shows the register form
 *   - trashRetentionDays: number      — shown to authenticated users in the
 *                                       trash view ("files are purged after N days")
 *
 * Quotas, storage root, and other admin-only knobs stay behind /api/admin/*.
 */
export async function GET() {
  const settings = await getAllSettings();
  return NextResponse.json({
    registrationOpen: settings.registrationOpen,
    trashRetentionDays: settings.trashRetentionDays,
  });
}
