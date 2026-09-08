/**
 * Disk-backed thumbnail cache under storage root `.thumbs/<nodeId>/`.
 *
 * Key includes source `updatedAt` so renames/replacements invalidate naturally.
 * Old size variants for the same node are pruned on write.
 *
 * THUMB_CACHE_VERSION — bump this when thumbnail generation logic changes
 * (e.g. adding .rotate() for EXIF orientation). This automatically
 * invalidates all existing cached thumbnails without manual cleanup.
 */

import type { StorageBackend } from "@/lib/storage";

export const THUMB_DIR = ".thumbs";

/**
 * Версия кэша миниатюр.
 * Увеличьте это значение при изменении логики генерации миниатюр,
 * чтобы автоматически инвалидировать все существующие кэши.
 *
 * v1 — initial version
 * v3 — added post-resize sharpen + raised JPEG quality (85) + video posters pre-scaled in ffmpeg
 */
export const THUMB_CACHE_VERSION = 3;

export function thumbCacheKey(nodeId: string, size: number, updatedAtMs: number): string {
  return `${THUMB_DIR}/v${THUMB_CACHE_VERSION}/${nodeId}/${size}-${updatedAtMs}.jpg`;
}

export function thumbEtag(nodeId: string, size: number, updatedAtMs: number): string {
  return `"v${THUMB_CACHE_VERSION}-${nodeId}-${size}-${updatedAtMs}"`;
}

/**
 * Полная очистка кэша миниатюр всех версий.
 * Используется после обновления логики генерации миниатюр.
 */
export async function clearThumbCache(storage: StorageBackend): Promise<number> {
  const prefix = `${THUMB_DIR}/`;
  let deletedCount = 0;

  // Получаем список версий/директорий
  let dirs: string[];
  try {
    dirs = await storage.list(prefix);
  } catch {
    return 0;
  }

  for (const dir of dirs) {
    // Получаем список nodeId директорий
    let nodeDirs: string[];
    try {
      nodeDirs = await storage.list(dir);
    } catch {
      continue;
    }

    for (const nodeDir of nodeDirs) {
      // Получаем список файлов в директории nodeId
      let files: string[];
      try {
        files = await storage.list(nodeDir);
      } catch {
        continue;
      }

      // Удаляем все файлы
      for (const file of files) {
        try {
          await storage.delete(file);
          deletedCount++;
        } catch {
          // ignore individual delete errors
        }
      }
    }
  }

  return deletedCount;
}

/** Delete stale thumb files for this node (other sizes / older mtimes). */
export async function pruneThumbCache(
  storage: StorageBackend,
  nodeId: string,
  keepKey: string
): Promise<void> {
  const prefix = `${THUMB_DIR}/v${THUMB_CACHE_VERSION}/${nodeId}/`;
  let keys: string[];
  try {
    keys = await storage.list(prefix);
  } catch {
    return;
  }
  await Promise.all(
    keys
      .filter((k) => k !== keepKey && !k.endsWith("/"))
      .map((k) => storage.delete(k).catch(() => undefined))
  );
}
