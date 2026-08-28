/**
 * Disk-backed thumbnail cache under storage root `.thumbs/<nodeId>/`.
 *
 * Key includes source `updatedAt` so renames/replacements invalidate naturally.
 * Old size variants for the same node are pruned on write.
 */

import type { StorageBackend } from "@/lib/storage";

export const THUMB_DIR = ".thumbs";

export function thumbCacheKey(nodeId: string, size: number, updatedAtMs: number): string {
  return `${THUMB_DIR}/${nodeId}/${size}-${updatedAtMs}.jpg`;
}

export function thumbEtag(nodeId: string, size: number, updatedAtMs: number): string {
  return `"${nodeId}-${size}-${updatedAtMs}"`;
}

/** Delete stale thumb files for this node (other sizes / older mtimes). */
export async function pruneThumbCache(
  storage: StorageBackend,
  nodeId: string,
  keepKey: string
): Promise<void> {
  const prefix = `${THUMB_DIR}/${nodeId}/`;
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
