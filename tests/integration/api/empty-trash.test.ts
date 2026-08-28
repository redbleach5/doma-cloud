import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as emptyTrash } from "@/app/api/files/empty-trash/route";
import { DELETE as deleteFile } from "@/app/api/files/[id]/route";
import { db, resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";

describe("POST /api/files/empty-trash", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let other: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;
  let _otherToken: string;


  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    other = await seedUser({ username: "bob" });
    token = await makeSessionToken(user);
    _otherToken = await makeSessionToken(other);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(emptyTrash, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("purges all trashed nodes owned by the caller", async () => {
    // Two trashed files + one active file (should NOT be touched).
    const t1 = await seedFile({ ownerId: user.id, parentId: null, name: "t1.jpg", deletedAt: new Date(), sizeBytes: 100n });
    const t2 = await seedFile({ ownerId: user.id, parentId: null, name: "t2.jpg", deletedAt: new Date(), sizeBytes: 200n });
    const active = await seedFile({ ownerId: user.id, parentId: null, name: "active.jpg", sizeBytes: 50n });

    const { response, data } = await callRoute<{ ok: boolean; purgedCount: number; usedBytes: string }>(emptyTrash, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.purgedCount).toBe(2);
    expect(data!.usedBytes).toBe("50"); // only `active` remains

    // Trashed rows gone.
    const stillT1 = await db.fileNode.findUnique({ where: { id: t1.id } });
    const stillT2 = await db.fileNode.findUnique({ where: { id: t2.id } });
    expect(stillT1).toBeNull();
    expect(stillT2).toBeNull();

    // Active row preserved.
    const stillActive = await db.fileNode.findUnique({ where: { id: active.id } });
    expect(stillActive).not.toBeNull();
  });

  it("recursively purges trashed folders with their descendants", async () => {
    // Trashed folder containing a trashed-at-the-same-time file.
    const deletedAt = new Date();
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder", deletedAt });
    const child = await seedFile({ ownerId: user.id, parentId: folder.id, name: "child.jpg", deletedAt, sizeBytes: 500n });

    const { data } = await callRoute<{ purgedCount: number }>(emptyTrash, {
      method: "POST",
      cookies: { doma_session: token },
    });
    // purgedCount counts top-level trash entries. The folder is top-level
    // (parentId null); the child is NOT top-level because its parent
    // (folder) is itself trashed — it gets purged as part of the folder.
    expect(data!.purgedCount).toBe(1);

    // Both the folder AND its child should be gone.
    const stillFolder = await db.fileNode.findUnique({ where: { id: folder.id } });
    const stillChild = await db.fileNode.findUnique({ where: { id: child.id } });
    expect(stillFolder).toBeNull();
    expect(stillChild).toBeNull();
  });

  it("does NOT purge another user's trash", async () => {
    // Bob has a trashed file. Alice empties her trash (which has nothing).
    const bobTrashed = await seedFile({ ownerId: other.id, parentId: null, name: "bob-t.jpg", deletedAt: new Date(), sizeBytes: 999n });

    const { data } = await callRoute<{ purgedCount: number }>(emptyTrash, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(data!.purgedCount).toBe(0);

    // Bob's file is still there.
    const stillThere = await db.fileNode.findUnique({ where: { id: bobTrashed.id } });
    expect(stillThere).not.toBeNull();
  });

  it("reports purgedCount:0 when trash is empty", async () => {
    const { data } = await callRoute<{ purgedCount: number }>(emptyTrash, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(data!.purgedCount).toBe(0);
  });

  it("purges trashed children inside active folders (orphans)", async () => {
    // Active folder containing a trashed file. The folder is NOT trashed,
    // so the trashed child is "top-level trash" (its parent isn't trashed)
    // and should be purged. The folder itself must stay intact.
    const activeFolder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "active-folder" });
    const trashedChild = await seedFile({ ownerId: user.id, parentId: activeFolder.id, name: "trashed.jpg", deletedAt: new Date(), sizeBytes: 100n });

    const { data } = await callRoute<{ purgedCount: number }>(emptyTrash, {
      method: "POST",
      cookies: { doma_session: token },
    });
    expect(data!.purgedCount).toBe(1); // the trashed child is top-level trash (its parent is NOT trashed)

    const stillFolder = await db.fileNode.findUnique({ where: { id: activeFolder.id } });
    expect(stillFolder).not.toBeNull();
    const stillChild = await db.fileNode.findUnique({ where: { id: trashedChild.id } });
    expect(stillChild).toBeNull();
  });
});

// Silence unused-import warning for `deleteFile` (kept for future tests).
void deleteFile;
