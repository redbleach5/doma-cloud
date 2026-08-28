import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  listChildren,
  computeDirectorySize,
  computeSubtreeSize,
  recomputeUserUsedBytes,
  purgeSubtree,
  ensureDirectory,
} from "@/lib/cloud/tree";
import { db, resetDb, seedUser, seedFile } from "../helpers/db";
import { makeTempStorage, cleanupTempStorage } from "../helpers/storage";

describe("tree.ts DB functions", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };

  beforeEach(async () => {
    await resetDb();
    const u = await seedUser({ username: "alice" });
    user = { id: u.id, username: u.username, role: u.role, tokenVersion: u.tokenVersion };
  });

  describe("listChildren", () => {
    it("returns an empty list for a fresh user at root", async () => {
      const children = await listChildren(user.id, null);
      expect(children).toHaveLength(0);
    });

    it("lists immediate children of root", async () => {
      await seedFile({ ownerId: user.id, parentId: null, name: "file1.txt", sizeBytes: 100n });
      await seedFile({ ownerId: user.id, parentId: null, name: "file2.txt", sizeBytes: 200n });
      const children = await listChildren(user.id, null);
      expect(children).toHaveLength(2);
      // Ordering: isDirectory desc, then name asc — both are files, so by name.
      expect(children[0].name).toBe("file1.txt");
      expect(children[1].name).toBe("file2.txt");
    });

    it("sorts directories before files", async () => {
      await seedFile({ ownerId: user.id, parentId: null, name: "zfile.txt" });
      await seedFile({ ownerId: user.id, parentId: null, name: "afolder", isDirectory: true });
      await seedFile({ ownerId: user.id, parentId: null, name: "bfolder", isDirectory: true });
      const children = await listChildren(user.id, null);
      expect(children[0].name).toBe("afolder");
      expect(children[1].name).toBe("bfolder");
      expect(children[2].name).toBe("zfile.txt");
    });

    it("excludes soft-deleted files by default", async () => {
      await seedFile({ ownerId: user.id, parentId: null, name: "active.txt" });
      await seedFile({
        ownerId: user.id,
        parentId: null,
        name: "deleted.txt",
        deletedAt: new Date(),
      });
      const children = await listChildren(user.id, null);
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe("active.txt");
    });

    it("includes soft-deleted files when includeDeleted=true", async () => {
      await seedFile({ ownerId: user.id, parentId: null, name: "active.txt" });
      await seedFile({
        ownerId: user.id,
        parentId: null,
        name: "deleted.txt",
        deletedAt: new Date(),
      });
      const children = await listChildren(user.id, null, true);
      expect(children).toHaveLength(2);
    });

    it("lists children of a specific parent folder", async () => {
      const folder = await seedFile({
        ownerId: user.id,
        parentId: null,
        name: "folder",
        isDirectory: true,
      });
      await seedFile({ ownerId: user.id, parentId: folder.id, name: "inside.txt" });
      await seedFile({ ownerId: user.id, parentId: null, name: "outside.txt" });
      const children = await listChildren(user.id, folder.id);
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe("inside.txt");
    });

    it("does NOT leak another user's files", async () => {
      const other = await seedUser({ username: "bob" });
      await seedFile({ ownerId: other.id, parentId: null, name: "bobs-file.txt" });
      await seedFile({ ownerId: user.id, parentId: null, name: "alices-file.txt" });
      const children = await listChildren(user.id, null);
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe("alices-file.txt");
    });
  });

  describe("computeDirectorySize", () => {
    it("returns 0 for an empty folder", async () => {
      const folder = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "empty",
      });
      const size = await computeDirectorySize(user.id, folder.id);
      expect(size).toBe(0n);
    });

    it("sums file sizes in a folder (non-recursive)", async () => {
      const folder = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "f",
      });
      await seedFile({ ownerId: user.id, parentId: folder.id, name: "a.txt", sizeBytes: 100n });
      await seedFile({ ownerId: user.id, parentId: folder.id, name: "b.txt", sizeBytes: 200n });
      const size = await computeDirectorySize(user.id, folder.id);
      expect(size).toBe(300n);
    });

    it("recursively sums nested folders", async () => {
      const root = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "root",
      });
      const sub = await seedFile({
        ownerId: user.id,
        parentId: root.id,
        isDirectory: true,
        name: "sub",
      });
      await seedFile({ ownerId: user.id, parentId: root.id, name: "a.txt", sizeBytes: 50n });
      await seedFile({ ownerId: user.id, parentId: sub.id, name: "b.txt", sizeBytes: 70n });
      await seedFile({
        ownerId: user.id,
        parentId: sub.id,
        isDirectory: true,
        name: "deep",
      });
      // Compute root size: 50 + 70 = 120
      const size = await computeDirectorySize(user.id, root.id);
      expect(size).toBe(120n);
    });

    it("excludes soft-deleted files from the sum", async () => {
      const folder = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "f",
      });
      await seedFile({ ownerId: user.id, parentId: folder.id, name: "active.txt", sizeBytes: 100n });
      await seedFile({
        ownerId: user.id,
        parentId: folder.id,
        name: "deleted.txt",
        sizeBytes: 500n,
        deletedAt: new Date(),
      });
      const size = await computeDirectorySize(user.id, folder.id);
      expect(size).toBe(100n);
    });

    it("returns 0 for root when no files exist", async () => {
      const size = await computeDirectorySize(user.id, null);
      expect(size).toBe(0n);
    });
  });

  describe("computeSubtreeSize", () => {
    it("returns the file's own size for a leaf file", async () => {
      const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt", sizeBytes: 123n });
      const size = await computeSubtreeSize(user.id, f.id);
      expect(size).toBe(123n);
    });

    it("returns 0 for a non-existent node", async () => {
      const size = await computeSubtreeSize(user.id, "nonexistent-id");
      expect(size).toBe(0n);
    });

    it("returns 0 if the node belongs to another user", async () => {
      const other = await seedUser({ username: "bob" });
      const f = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.txt", sizeBytes: 999n });
      const size = await computeSubtreeSize(user.id, f.id);
      expect(size).toBe(0n);
    });

    it("excludes soft-deleted descendants of a directory", async () => {
      const root = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "root",
      });
      await seedFile({ ownerId: user.id, parentId: root.id, name: "a.txt", sizeBytes: 10n });
      // computeSubtreeSize skips deleted files — their bytes were already
      // subtracted from usedBytes when they were trashed.
      await seedFile({
        ownerId: user.id,
        parentId: root.id,
        name: "b.txt",
        sizeBytes: 20n,
        deletedAt: new Date(),
      });
      const size = await computeSubtreeSize(user.id, root.id);
      expect(size).toBe(10n);
    });
  });

  describe("recomputeUserUsedBytes", () => {
    it("returns 0 and persists 0 for a fresh user", async () => {
      const size = await recomputeUserUsedBytes(user.id);
      expect(size).toBe(0n);
      const u = await db.user.findUnique({ where: { id: user.id } });
      expect(u?.usedBytes).toBe(0n);
    });

    it("sums all non-deleted files for the user and persists the result", async () => {
      await seedFile({ ownerId: user.id, parentId: null, name: "a.txt", sizeBytes: 100n });
      await seedFile({ ownerId: user.id, parentId: null, name: "b.txt", sizeBytes: 200n });
      // Deleted files should NOT count.
      await seedFile({
        ownerId: user.id,
        parentId: null,
        name: "c.txt",
        sizeBytes: 500n,
        deletedAt: new Date(),
      });
      // Directories should NOT count.
      await seedFile({
        ownerId: user.id,
        parentId: null,
        name: "folder",
        isDirectory: true,
      });
      const size = await recomputeUserUsedBytes(user.id);
      expect(size).toBe(300n);
      const u = await db.user.findUnique({ where: { id: user.id } });
      expect(u?.usedBytes).toBe(300n);
    });

    it("corrects drift between the cached counter and the actual sum", async () => {
      // Manually set the cached counter to a wrong value.
      await db.user.update({ where: { id: user.id }, data: { usedBytes: 9999n } });
      await seedFile({ ownerId: user.id, parentId: null, name: "a.txt", sizeBytes: 100n });
      const size = await recomputeUserUsedBytes(user.id);
      expect(size).toBe(100n);
      const u = await db.user.findUnique({ where: { id: user.id } });
      expect(u?.usedBytes).toBe(100n);
    });
  });

  describe("purgeSubtree", () => {
    let storage: { delete: (key: string) => Promise<void> };

    beforeEach(async () => {
      const ctx = await makeTempStorage();
      storage = ctx.storage;
    });

    afterEach(async () => {
      await cleanupTempStorage();
    });

    it("deletes a single file node + its storage object", async () => {
      const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt", sizeBytes: 10n, storageKey: "key1" });
      const deleteCalls: string[] = [];
      const fakeStorage = {
        delete: async (key: string) => { deleteCalls.push(key); },
      };
      await purgeSubtree(user.id, f.id, fakeStorage);
      expect(deleteCalls).toEqual(["key1"]);
      const node = await db.fileNode.findUnique({ where: { id: f.id } });
      expect(node).toBeNull();
    });

    it("recursively deletes a directory and all descendants", async () => {
      const root = await seedFile({
        ownerId: user.id,
        parentId: null,
        isDirectory: true,
        name: "root",
      });
      const sub = await seedFile({
        ownerId: user.id,
        parentId: root.id,
        isDirectory: true,
        name: "sub",
      });
      const f1 = await seedFile({ ownerId: user.id, parentId: root.id, name: "f1.txt", storageKey: "k1" });
      const f2 = await seedFile({ ownerId: user.id, parentId: sub.id, name: "f2.txt", storageKey: "k2" });

      const deleteCalls: string[] = [];
      const fakeStorage = {
        delete: async (key: string) => { deleteCalls.push(key); },
      };
      await purgeSubtree(user.id, root.id, fakeStorage);

      // Both files' storage should be deleted.
      expect(deleteCalls.sort()).toEqual(["k1", "k2"]);
      // All three nodes (root, sub, f1, f2) should be gone.
      expect(await db.fileNode.findUnique({ where: { id: root.id } })).toBeNull();
      expect(await db.fileNode.findUnique({ where: { id: sub.id } })).toBeNull();
      expect(await db.fileNode.findUnique({ where: { id: f1.id } })).toBeNull();
      expect(await db.fileNode.findUnique({ where: { id: f2.id } })).toBeNull();
    });

    it("continues deleting DB rows even if storage.delete throws", async () => {
      const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt", storageKey: "k1" });
      const fakeStorage = {
        delete: async () => { throw new Error("storage unavailable"); },
      };
      // Should NOT throw — storage errors are best-effort.
      await purgeSubtree(user.id, f.id, fakeStorage);
      const node = await db.fileNode.findUnique({ where: { id: f.id } });
      expect(node).toBeNull();
    });

    it("is a no-op for a non-existent node id", async () => {
      const fakeStorage = { delete: async () => undefined };
      await expect(purgeSubtree(user.id, "nonexistent", fakeStorage)).resolves.toBeUndefined();
    });
  });

  describe("ensureDirectory (mkdir -p style)", () => {
    it("returns null for an empty path segments array", async () => {
      const result = await ensureDirectory(user.id, []);
      expect(result).toBeNull();
    });

    it("creates a single top-level directory", async () => {
      const result = await ensureDirectory(user.id, ["photos"]);
      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      const node = await db.fileNode.findUnique({ where: { id: result!.id } });
      expect(node?.name).toBe("photos");
      expect(node?.isDirectory).toBe(true);
      expect(node?.parentId).toBeNull();
    });

    it("creates nested directories", async () => {
      const result = await ensureDirectory(user.id, ["photos", "2024", "summer"]);
      expect(result).not.toBeNull();
      expect(result!.created).toBe(true);
      // All three should exist.
      const leaf = await db.fileNode.findUnique({ where: { id: result!.id } });
      expect(leaf?.name).toBe("summer");
      const mid = await db.fileNode.findUnique({ where: { id: leaf!.parentId! } });
      expect(mid?.name).toBe("2024");
      const top = await db.fileNode.findUnique({ where: { id: mid!.parentId! } });
      expect(top?.name).toBe("photos");
      expect(top?.parentId).toBeNull();
    });

    it("reuses existing directories (created=false) and creates missing ones", async () => {
      // First call creates "photos/2024"
      const first = await ensureDirectory(user.id, ["photos", "2024"]);
      expect(first!.created).toBe(true);
      // Second call: "photos" exists (created=false), "2024" exists (created=false), "winter" is new.
      const second = await ensureDirectory(user.id, ["photos", "2024", "winter"]);
      expect(second!.created).toBe(true);
      // The intermediate "photos" and "2024" should NOT have been duplicated.
      const photosCount = await db.fileNode.count({
        where: { ownerId: user.id, parentId: null, name: "photos", isDirectory: true },
      });
      expect(photosCount).toBe(1);
      const y2024Count = await db.fileNode.count({
        where: { ownerId: user.id, name: "2024", isDirectory: true },
      });
      expect(y2024Count).toBe(1);
    });

    it("does NOT reuse soft-deleted directories (creates a fresh one)", async () => {
      // Create then soft-delete a directory.
      const first = await ensureDirectory(user.id, ["photos"]);
      await db.fileNode.update({
        where: { id: first!.id },
        data: { deletedAt: new Date() },
      });
      // Now ensureDirectory should create a NEW one (not reuse the deleted).
      const second = await ensureDirectory(user.id, ["photos"]);
      expect(second!.created).toBe(true);
      expect(second!.id).not.toBe(first!.id);
      // Two directories with the same name at root, one deleted and one not.
      const count = await db.fileNode.count({
        where: { ownerId: user.id, parentId: null, name: "photos", isDirectory: true },
      });
      expect(count).toBe(2);
    });
  });
});
