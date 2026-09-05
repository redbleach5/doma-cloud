import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getAllSettings, setSetting } from "@/lib/cloud/settings";
import { z } from "zod";

/** GET — current system settings (with defaults applied). */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const settings = await getAllSettings();
  return NextResponse.json({
    settings: {
      defaultQuotaBytes: settings.defaultQuotaBytes.toString(),
      adminQuotaBytes: settings.adminQuotaBytes.toString(),
      registrationOpen: settings.registrationOpen,
      trashRetentionDays: settings.trashRetentionDays,
      storageLocalRoot: settings.storageLocalRoot,
    },
  });
}

const PatchSchema = z.object({
  defaultQuotaBytes: z.string().optional(),
  adminQuotaBytes: z.string().optional(),
  registrationOpen: z.boolean().optional(),
  trashRetentionDays: z.number().int().min(0).max(3650).optional(),
});

/** PATCH — update system settings. */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Неверные данные" },
      { status: 422 }
    );
  }

  if (parsed.data.defaultQuotaBytes !== undefined) {
    try {
      await setSetting("defaultQuotaBytes", BigInt(parsed.data.defaultQuotaBytes));
    } catch {
      return NextResponse.json({ error: "Неверный размер квоты" }, { status: 422 });
    }
  }
  if (parsed.data.adminQuotaBytes !== undefined) {
    try {
      await setSetting("adminQuotaBytes", BigInt(parsed.data.adminQuotaBytes));
    } catch {
      return NextResponse.json({ error: "Неверный размер админ-квоты" }, { status: 422 });
    }
  }
  if (parsed.data.registrationOpen !== undefined) {
    await setSetting("registrationOpen", parsed.data.registrationOpen);
  }
  if (parsed.data.trashRetentionDays !== undefined) {
    await setSetting("trashRetentionDays", parsed.data.trashRetentionDays);
  }

  const settings = await getAllSettings();
  return NextResponse.json({
    settings: {
      defaultQuotaBytes: settings.defaultQuotaBytes.toString(),
      adminQuotaBytes: settings.adminQuotaBytes.toString(),
      registrationOpen: settings.registrationOpen,
      trashRetentionDays: settings.trashRetentionDays,
      storageLocalRoot: settings.storageLocalRoot,
    },
  });
}
