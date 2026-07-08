import { NextResponse } from "next/server";
import { getAllSettings } from "@/lib/cloud/settings";

/**
 * Public endpoint — returns only the settings that affect anonymous users.
 * Used by the login screen to decide whether to show the registration form.
 *
 * No auth required. Returns only:
 *   - registrationOpen: boolean
 *
 * Everything else (defaultQuotaBytes, trashRetentionDays, maxChunkSizeBytes)
 * is admin-only and NOT exposed here.
 */
export async function GET() {
  const settings = await getAllSettings();
  return NextResponse.json({
    registrationOpen: settings.registrationOpen,
  });
}
