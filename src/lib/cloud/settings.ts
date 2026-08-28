/**
 * System settings helpers — key/value store backed by the Setting table.
 *
 * Defaults are applied transparently when a key is missing, so the app
 * works out of the box without manual seeding.
 */

import { db } from "@/lib/db";

export const DEFAULTS = {
  /** Default quota for newly registered (non-admin) users, in bytes. */
  defaultQuotaBytes: 50n * 1024n * 1024n * 1024n, // 50 GB
  /** Quota for the first user (admin) and for newly-created admins, in bytes. */
  adminQuotaBytes: 3n * 1024n * 1024n * 1024n * 1024n, // 3 TB
  /** Whether new user registration is open to anyone with the URL. */
  registrationOpen: true as boolean,
  /** Trash auto-purge age in days. 0 = never auto-purge. */
  trashRetentionDays: 30 as number,
  /**
   * Admin-configured local storage root. When non-null, overrides the
   * STORAGE_LOCAL_ROOT env var at runtime. Used by the admin dashboard
   * to switch between disks without editing .env. Null = use env default.
   */
  storageLocalRoot: null as string | null,
} as const;

export type SettingKey = keyof typeof DEFAULTS;

/** Read a single setting, applying the default if absent. */
export async function getSetting<K extends SettingKey>(
  key: K
): Promise<typeof DEFAULTS[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return DEFAULTS[key];
  return deserialize(key, row.value) as typeof DEFAULTS[K];
}

/** Read all settings at once. */
export async function getAllSettings() {
  const rows = await db.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    defaultQuotaBytes: map.has("defaultQuotaBytes")
      ? BigInt(map.get("defaultQuotaBytes")!)
      : DEFAULTS.defaultQuotaBytes,
    adminQuotaBytes: map.has("adminQuotaBytes")
      ? BigInt(map.get("adminQuotaBytes")!)
      : DEFAULTS.adminQuotaBytes,
    registrationOpen: map.has("registrationOpen")
      ? map.get("registrationOpen") === "true"
      : DEFAULTS.registrationOpen,
    trashRetentionDays: map.has("trashRetentionDays")
      ? parseInt(map.get("trashRetentionDays")!, 10)
      : DEFAULTS.trashRetentionDays,
    storageLocalRoot: map.has("storageLocalRoot")
      ? (map.get("storageLocalRoot") === "" ? null : map.get("storageLocalRoot")!)
      : DEFAULTS.storageLocalRoot,
  };
}

/** Update a setting. */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: typeof DEFAULTS[K]
): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: serialize(key, value) },
    update: { value: serialize(key, value) },
  });
}

function serialize<K extends SettingKey>(key: K, value: typeof DEFAULTS[K]): string {
  // null/undefined → empty string marker. Without this, String(null) === "null"
  // and deserialize would return the string "null" (which is truthy and gets
  // used as a real path — see getLocalStorageRoot).
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function deserialize<K extends SettingKey>(key: K, raw: string): unknown {
  const sample = DEFAULTS[key];
  // If the default is null (string | null type), empty string means null.
  if (sample === null) return raw === "" ? null : raw;
  if (typeof sample === "bigint") return BigInt(raw);
  if (typeof sample === "boolean") return raw === "true";
  if (typeof sample === "number") return parseInt(raw, 10);
  return raw;
}
