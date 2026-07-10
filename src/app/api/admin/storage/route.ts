import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getStorageStatus,
  validateStorageRoot,
  probeWritable,
} from "@/lib/storage/inspect";
import { getSetting, setSetting } from "@/lib/cloud/settings";
import { resetStorageCache } from "@/lib/storage";

/**
 * GET /api/admin/storage
 *
 * Returns the current storage configuration and all available disk mounts
 * so the admin dashboard can render the disk-picker UI.
 *
 * Query params:
 *   skipUsed=1  — skip computing the recursive size of the storage root
 *                 (can be slow on huge directories). When skipped,
 *                 localRootUsedBytes will be null.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const skipUsed = req.nextUrl.searchParams.get("skipUsed") === "1";
  const status = await getStorageStatus();

  // Honor skipUsed to keep the response fast.
  if (skipUsed) {
    status.localRootUsedBytes = null;
  }

  // Also surface the DB-configured override so the UI can show it
  // separately from the env var fallback.
  const dbOverride = await getSetting("storageLocalRoot");

  return NextResponse.json({
    ...status,
    dbConfiguredRoot: dbOverride,
    envConfiguredRoot: process.env.STORAGE_LOCAL_ROOT ?? null,
  });
}

/**
 * PATCH /api/admin/storage
 *
 * Update the local storage root. Body: { storageLocalRoot: string | null }
 *
 * - Setting to null clears the DB override and falls back to env var.
 * - Setting to a path validates it (absolute, not a system dir, writable)
 *   and creates it if missing.
 *
 * IMPORTANT: switching the root does NOT move existing files. The admin
 * gets a clear warning in the UI before confirming. New uploads go to
 * the new location; existing files remain at the old location and are
 * still downloadable via the cached storage backend.
 *
 * To make the change take effect, we reset the storage cache so the next
 * `getStorage()` call re-creates the backend with the new root.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const { storageLocalRoot } = body as { storageLocalRoot?: string | null };

  if (storageLocalRoot === null) {
    // Clear the override — fall back to env var.
    await setSetting("storageLocalRoot", null);
    resetStorageCache();
    return NextResponse.json({ ok: true, storageLocalRoot: null });
  }

  if (typeof storageLocalRoot !== "string" || !storageLocalRoot.trim()) {
    return NextResponse.json(
      { error: "Нужен путь к директории хранилища" },
      { status: 422 }
    );
  }

  // Validate + create the directory if needed.
  let validated: string;
  try {
    validated = await validateStorageRoot(storageLocalRoot.trim());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Неверный путь" },
      { status: 422 }
    );
  }

  // Probe that we can actually write to it.
  if (!(await probeWritable(validated))) {
    return NextResponse.json(
      { error: "Директория недоступна для записи" },
      { status: 422 }
    );
  }

  await setSetting("storageLocalRoot", validated);
  resetStorageCache();

  return NextResponse.json({ ok: true, storageLocalRoot: validated });
}
