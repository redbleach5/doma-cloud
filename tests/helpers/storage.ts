/**
 * Storage test helpers.
 *
 * Provides a fresh temp directory per test and a LocalFileStorage instance
 * pointed at it. Tests that exercise storage backends should use this to
 * avoid polluting the project's real storage-data/ directory.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalFileStorage, resetStorageCache, getStorage } from "@/lib/storage";

let tempRoot: string | null = null;

/**
 * Set up a fresh temp directory as STORAGE_LOCAL_ROOT and return a
 * LocalFileStorage instance pointed at it. Call `cleanupTempStorage()`
 * in afterEach to remove the directory.
 */
export async function makeTempStorage(): Promise<{
  root: string;
  storage: LocalFileStorage;
}> {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "doma-test-storage-"));
  process.env.STORAGE_LOCAL_ROOT = tempRoot;
  resetStorageCache();
  const storage = getStorage() as LocalFileStorage;
  return { root: tempRoot, storage };
}

/** Remove the temp storage directory created by `makeTempStorage()`. */
export async function cleanupTempStorage(): Promise<void> {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    tempRoot = null;
  }
  resetStorageCache();
}
