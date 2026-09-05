import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { requireAdmin } from "@/lib/auth/require-admin";
import { clearThumbCache } from "@/lib/cloud/thumbnail-cache";

/**
 * POST /api/admin/clear-thumbnail-cache
 *
 * Полная очистка кэша миниатюр.
 * Используется после обновления логики генерации миниатюр (например, добавления .rotate()).
 *
 * Все миниатюры будут перегенерированы при следующем запросе.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  const storage = await getStorage();
  const deletedCount = await clearThumbCache(storage);

  return NextResponse.json({
    ok: true,
    deleted: deletedCount,
    message: `Кэш миниатюр очищен. Удалено файлов: ${deletedCount}`,
  });
}