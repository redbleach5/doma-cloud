import { describe, expect, it, beforeEach } from "bun:test";
import {
  getSetting,
  getAllSettings,
  setSetting,
  DEFAULTS,
} from "@/lib/cloud/settings";
import { db, resetDb } from "../helpers/db";

describe("settings (DB-backed key/value store)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("DEFAULTS", () => {
    it("exports the expected default values", () => {
      expect(DEFAULTS.defaultQuotaBytes).toBe(50n * 1024n * 1024n * 1024n); // 50 GB
      expect(DEFAULTS.adminQuotaBytes).toBe(3n * 1024n * 1024n * 1024n * 1024n); // 3 TB
      expect(DEFAULTS.registrationOpen).toBe(true);
      expect(DEFAULTS.trashRetentionDays).toBe(30);
    });
  });

  describe("getSetting", () => {
    it("returns the default when the key is absent", async () => {
      expect(await getSetting("defaultQuotaBytes")).toBe(DEFAULTS.defaultQuotaBytes);
      expect(await getSetting("adminQuotaBytes")).toBe(DEFAULTS.adminQuotaBytes);
      expect(await getSetting("registrationOpen")).toBe(DEFAULTS.registrationOpen);
      expect(await getSetting("trashRetentionDays")).toBe(DEFAULTS.trashRetentionDays);
    });

    it("returns the stored value when the key is set", async () => {
      await setSetting("defaultQuotaBytes", 100n * 1024n * 1024n * 1024n);
      expect(await getSetting("defaultQuotaBytes")).toBe(100n * 1024n * 1024n * 1024n);

      await setSetting("registrationOpen", false);
      expect(await getSetting("registrationOpen")).toBe(false);

      await setSetting("trashRetentionDays", 7);
      expect(await getSetting("trashRetentionDays")).toBe(7);
    });

    it("correctly deserializes each type (bigint, boolean, number)", async () => {
      await setSetting("defaultQuotaBytes", 123n);
      const v = await getSetting("defaultQuotaBytes");
      expect(typeof v).toBe("bigint");
      expect(v).toBe(123n);

      await setSetting("registrationOpen", true);
      const b = await getSetting("registrationOpen");
      expect(typeof b).toBe("boolean");
      expect(b).toBe(true);

      await setSetting("trashRetentionDays", 42);
      const n = await getSetting("trashRetentionDays");
      expect(typeof n).toBe("number");
      expect(n).toBe(42);
    });
  });

  describe("setSetting + getSetting round-trip", () => {
    it("upserts (creates then updates) without error", async () => {
      // First call creates the row.
      await setSetting("trashRetentionDays", 14);
      expect(await getSetting("trashRetentionDays")).toBe(14);
      // Second call updates the same row.
      await setSetting("trashRetentionDays", 60);
      expect(await getSetting("trashRetentionDays")).toBe(60);
      // Only one row should exist.
      const count = await db.setting.count();
      expect(count).toBe(1);
    });

    it("stores bigint values as decimal strings in the DB", async () => {
      await setSetting("defaultQuotaBytes", 999n);
      const row = await db.setting.findUnique({ where: { key: "defaultQuotaBytes" } });
      expect(row?.value).toBe("999");
    });

    it("stores boolean values as 'true' / 'false' strings", async () => {
      await setSetting("registrationOpen", true);
      let row = await db.setting.findUnique({ where: { key: "registrationOpen" } });
      expect(row?.value).toBe("true");

      await setSetting("registrationOpen", false);
      row = await db.setting.findUnique({ where: { key: "registrationOpen" } });
      expect(row?.value).toBe("false");
    });

    it("stores number values as decimal strings", async () => {
      await setSetting("trashRetentionDays", 90);
      const row = await db.setting.findUnique({ where: { key: "trashRetentionDays" } });
      expect(row?.value).toBe("90");
    });
  });

  describe("getAllSettings", () => {
    it("returns all defaults when nothing is set", async () => {
      const all = await getAllSettings();
      expect(all.defaultQuotaBytes).toBe(DEFAULTS.defaultQuotaBytes);
      expect(all.adminQuotaBytes).toBe(DEFAULTS.adminQuotaBytes);
      expect(all.registrationOpen).toBe(DEFAULTS.registrationOpen);
      expect(all.trashRetentionDays).toBe(DEFAULTS.trashRetentionDays);
    });

    it("returns stored values, falling back to defaults for missing keys", async () => {
      await setSetting("registrationOpen", false);
      await setSetting("trashRetentionDays", 7);
      const all = await getAllSettings();
      expect(all.registrationOpen).toBe(false);
      expect(all.trashRetentionDays).toBe(7);
      // The other two should still be defaults.
      expect(all.defaultQuotaBytes).toBe(DEFAULTS.defaultQuotaBytes);
      expect(all.adminQuotaBytes).toBe(DEFAULTS.adminQuotaBytes);
    });

    it("returns bigint values as actual bigints (not strings)", async () => {
      await setSetting("defaultQuotaBytes", 5n);
      const all = await getAllSettings();
      expect(typeof all.defaultQuotaBytes).toBe("bigint");
      expect(all.defaultQuotaBytes).toBe(5n);
    });

    it("handles all four keys set to non-default values", async () => {
      await setSetting("defaultQuotaBytes", 1n);
      await setSetting("adminQuotaBytes", 2n);
      await setSetting("registrationOpen", false);
      await setSetting("trashRetentionDays", 99);
      const all = await getAllSettings();
      expect(all.defaultQuotaBytes).toBe(1n);
      expect(all.adminQuotaBytes).toBe(2n);
      expect(all.registrationOpen).toBe(false);
      expect(all.trashRetentionDays).toBe(99);
    });
  });
});
