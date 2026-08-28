import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as mkdir } from "@/app/api/files/mkdir/route";
import { GET as listFiles } from "@/app/api/files/list/route";
import { PATCH as renameFile } from "@/app/api/files/[id]/rename/route";
import { DELETE as deleteFile, PATCH as restoreFile } from "@/app/api/files/[id]/route";
import { POST as uploadFile } from "@/app/api/files/upload/route";
import { db, resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";

describe("POST /api/files/mkdir", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    const ctx = await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(mkdir, {
      method: "POST",
      body: { name: "newfolder" },
    });
    expect(response.status).toBe(401);
  });

  it("creates a directory at root", async () => {
    const { response, data } = await callRoute<{ id: string; name: string }>(mkdir, {
      method: "POST",
      body: { name: "photos" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.name).toBe("photos");
    expect(data!.id).toBeDefined();
    const node = await db.fileNode.findUnique({ where: { id: data!.id } });
    expect(node?.isDirectory).toBe(true);
    expect(node?.parentId).toBeNull();
  });

  it("creates a directory inside a parent folder", async () => {
    const parent = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "parent" });
    const { response, data } = await callRoute<{ id: string; name: string }>(mkdir, {
      method: "POST",
      url: `http://localhost:3000/api/files/mkdir?parentId=${parent.id}`,
      body: { name: "child" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    const node = await db.fileNode.findUnique({ where: { id: data!.id } });
    expect(node?.parentId).toBe(parent.id);
  });

  it("returns 404 when the parent folder doesn't exist", async () => {
    const { response } = await callRoute(mkdir, {
      method: "POST",
      url: "http://localhost:3000/api/files/mkdir?parentId=nonexistent",
      body: { name: "child" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the parent belongs to another user", async () => {
    const other = await seedUser({ username: "bob" });
    const otherFolder = await seedFile({ ownerId: other.id, parentId: null, isDirectory: true, name: "bobs" });
    const { response } = await callRoute(mkdir, {
      method: "POST",
      url: `http://localhost:3000/api/files/mkdir?parentId=${otherFolder.id}`,
      body: { name: "child" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the parent is a file (not a directory)", async () => {
    const fileNode = await seedFile({ ownerId: user.id, parentId: null, name: "file.txt" });
    const { response } = await callRoute(mkdir, {
      method: "POST",
      url: `http://localhost:3000/api/files/mkdir?parentId=${fileNode.id}`,
      body: { name: "child" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 on duplicate name in the same folder", async () => {
    await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "photos" });
    const { response } = await callRoute(mkdir, {
      method: "POST",
      body: { name: "photos" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(409);
  });

  it("sanitizes the directory name", async () => {
    const { data } = await callRoute<{ name: string }>(mkdir, {
      method: "POST",
      body: { name: "../etc/passwd" },
      cookies: { doma_session: token },
    });
    // Step 1: forbidden chars (/) → _ : ".._etc_passwd"
    // Step 2: strip leading dots: "_etc_passwd"
    // Step 3: trim: "_etc_passwd"
    expect(data!.name).toBe("_etc_passwd");
  });

  it("returns 'untitled' for a name that sanitizes to empty (dots get stripped)", async () => {
    // "..." → strip leading dots → "" → falls through to || "untitled"
    const { response, data } = await callRoute<{ name: string }>(mkdir, {
      method: "POST",
      body: { name: "..." },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.name).toBe("untitled");
  });

  it("returns 400 for invalid JSON", async () => {
    const { response } = await callRoute(mkdir, {
      method: "POST",
      rawBody: "{invalid",
      contentType: "application/json",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/files/list", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    const ctx = await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(listFiles, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("returns an empty list for a fresh user at root", async () => {
    const { response, data } = await callRoute<{ items: unknown[] }>(listFiles, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(0);
  });

  it("lists files at root", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "a.txt" });
    await seedFile({ ownerId: user.id, parentId: null, name: "b.txt" });
    const { data } = await callRoute<{ items: { id: string; name: string }[] }>(listFiles, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.items).toHaveLength(2);
    expect(data!.items.map((i) => i.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("lists files inside a specific parent folder", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "f" });
    await seedFile({ ownerId: user.id, parentId: folder.id, name: "inside.txt" });
    await seedFile({ ownerId: user.id, parentId: null, name: "outside.txt" });
    const { data } = await callRoute<{ items: { name: string }[] }>(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?parentId=${folder.id}`,
      cookies: { doma_session: token },
    });
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].name).toBe("inside.txt");
  });

  it("includes category in the response", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "photo.jpg", mimeType: "image/jpeg" });
    const { data } = await callRoute<{ items: { category: string }[] }>(listFiles, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.items[0].category).toBe("image");
  });

  it("excludes soft-deleted files by default", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "active.txt" });
    await seedFile({ ownerId: user.id, parentId: null, name: "deleted.txt", deletedAt: new Date() });
    const { data } = await callRoute<{ items: { name: string }[] }>(listFiles, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].name).toBe("active.txt");
  });

  it("shows top-level trashed items with ?trashed=1", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "deleted.txt", deletedAt: new Date() });
    const { data } = await callRoute<{ items: { name: string }[] }>(listFiles, {
      method: "GET",
      url: "http://localhost:3000/api/files/list?trashed=1",
      cookies: { doma_session: token },
    });
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].name).toBe("deleted.txt");
  });

  it("with ?trashed=1 does NOT show nested children of a deleted folder", async () => {
    // Trash view shows only TOP-LEVEL deleted items (parent is null or not deleted).
    const folder = await seedFile({
      ownerId: user.id,
      parentId: null,
      isDirectory: true,
      name: "folder",
      deletedAt: new Date(),
    });
    await seedFile({
      ownerId: user.id,
      parentId: folder.id,
      name: "inside.txt",
      deletedAt: new Date(), // same timestamp (deleted with parent)
    });
    const { data } = await callRoute<{ items: { name: string }[] }>(listFiles, {
      method: "GET",
      url: "http://localhost:3000/api/files/list?trashed=1",
      cookies: { doma_session: token },
    });
    // Only the folder shows up, not the inside.txt
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].name).toBe("folder");
  });

  it("does NOT list another user's files", async () => {
    const other = await seedUser({ username: "bob" });
    await seedFile({ ownerId: other.id, parentId: null, name: "bobs-secret.txt" });
    const { data } = await callRoute<{ items: { name: string }[] }>(listFiles, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(data!.items).toHaveLength(0);
  });

  it("paginates with limit/cursor and reports hasMore", async () => {
    for (let i = 0; i < 5; i++) {
      await seedFile({
        ownerId: user.id,
        parentId: null,
        name: `f${i}.txt`,
      });
    }
    const page1 = await callRoute<{
      items: { name: string }[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(listFiles, {
      method: "GET",
      url: "http://localhost:3000/api/files/list?limit=2",
      cookies: { doma_session: token },
    });
    expect(page1.response.status).toBe(200);
    expect(page1.data!.items).toHaveLength(2);
    expect(page1.data!.hasMore).toBe(true);
    expect(page1.data!.nextCursor).toBeTruthy();

    const page2 = await callRoute<{
      items: { name: string }[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?limit=2&cursor=${encodeURIComponent(page1.data!.nextCursor!)}`,
      cookies: { doma_session: token },
    });
    expect(page2.data!.items).toHaveLength(2);
    expect(page2.data!.hasMore).toBe(true);

    const page3 = await callRoute<{
      items: { name: string }[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?limit=2&cursor=${encodeURIComponent(page2.data!.nextCursor!)}`,
      cookies: { doma_session: token },
    });
    expect(page3.data!.items).toHaveLength(1);
    expect(page3.data!.hasMore).toBe(false);
    expect(page3.data!.nextCursor).toBeNull();

    const names = [
      ...page1.data!.items,
      ...page2.data!.items,
      ...page3.data!.items,
    ].map((i) => i.name);
    expect(names.sort()).toEqual(["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt"]);
  });

  it("lists folders before files across page boundaries", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "zzz.txt" });
    await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "aaa",
      isDirectory: true,
    });
    const page1 = await callRoute<{ items: { name: string; isDirectory: boolean }[] }>(
      listFiles,
      {
        method: "GET",
        url: "http://localhost:3000/api/files/list?limit=1",
        cookies: { doma_session: token },
      }
    );
    expect(page1.data!.items).toHaveLength(1);
    expect(page1.data!.items[0].isDirectory).toBe(true);
    expect(page1.data!.items[0].name).toBe("aaa");
  });
});

describe("PATCH /api/files/[id]/rename", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "old.txt" });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "new.txt" },
    });
    expect(response.status).toBe(401);
  });

  it("renames a file", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "old.txt" });
    const { response, data } = await callRoute<{ ok: boolean; name: string }>(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "new.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    expect(data!.name).toBe("new.txt");
    const node = await db.fileNode.findUnique({ where: { id: f.id } });
    expect(node?.name).toBe("new.txt");
  });

  it("returns 404 for a non-existent file", async () => {
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: "nonexistent" },
      body: { name: "new.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a file belonging to another user", async () => {
    const other = await seedUser({ username: "bob" });
    const f = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.txt" });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "hacked.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a trashed file", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "trashed.txt", deletedAt: new Date() });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "renamed.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 if the new name already exists in the same folder", async () => {
    await seedFile({ ownerId: user.id, parentId: null, name: "existing.txt" });
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "old.txt" });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "existing.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(409);
  });

  it("allows renaming to the SAME name (no conflict with itself)", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "same.txt" });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "same.txt" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
  });

  it("returns 422 for an empty name", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "old.txt" });
    const { response } = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("sanitizes the new name", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "old.txt" });
    const { data } = await callRoute<{ name: string }>(renameFile, {
      method: "PATCH",
      params: { id: f.id },
      body: { name: "new/name?:txt" },
      cookies: { doma_session: token },
    });
    expect(data!.name).toBe("new_name__txt");
  });
});

describe("DELETE /api/files/[id] (soft delete) + PATCH (restore)", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt" });
    const { response } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: f.id },
    });
    expect(response.status).toBe(401);
  });

  it("soft-deletes a file (moves to trash)", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt", sizeBytes: 100n });
    const { response, data } = await callRoute<{ ok: boolean; usedBytes: string }>(deleteFile, {
      method: "DELETE",
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    const node = await db.fileNode.findUnique({ where: { id: f.id } });
    expect(node?.deletedAt).not.toBeNull();
  });

  it("decrements user.usedBytes on soft delete", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt", sizeBytes: 500n });
    await db.user.update({ where: { id: user.id }, data: { usedBytes: 500n } });
    const { data } = await callRoute<{ usedBytes: string }>(deleteFile, {
      method: "DELETE",
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(BigInt(data!.usedBytes)).toBe(0n);
  });

  it("soft-deletes a folder AND all descendants with the same timestamp", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "f" });
    const child1 = await seedFile({ ownerId: user.id, parentId: folder.id, name: "c1.txt" });
    const child2 = await seedFile({ ownerId: user.id, parentId: folder.id, name: "c2.txt" });
    const { data } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: folder.id },
      cookies: { doma_session: token },
    });
    expect(data).toMatchObject({ ok: true });
    // All three should be deleted with the SAME timestamp.
    const f = await db.fileNode.findUnique({ where: { id: folder.id } });
    const c1 = await db.fileNode.findUnique({ where: { id: child1.id } });
    const c2 = await db.fileNode.findUnique({ where: { id: child2.id } });
    expect(f?.deletedAt).not.toBeNull();
    expect(c1?.deletedAt).not.toBeNull();
    expect(c2?.deletedAt).not.toBeNull();
    expect(c1?.deletedAt?.getTime()).toBe(f?.deletedAt?.getTime());
    expect(c2?.deletedAt?.getTime()).toBe(f?.deletedAt?.getTime());
  });

  it("returns 404 for a non-existent file", async () => {
    const { response } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: "nonexistent" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for another user's file", async () => {
    const other = await seedUser({ username: "bob" });
    const f = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.txt" });
    const { response } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("hard-deletes with ?hard=1 and purges storage", async () => {
    const f = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "f.txt",
      sizeBytes: 100n,
      storageKey: "alice/key1/f.txt",
    });
    // Write a real storage object so purgeSubtree can delete it.
    const storage = await (await import("@/lib/storage")).getStorage();
    await storage.put("alice/key1/f.txt", Buffer.from("data"));

    const { response, data } = await callRoute<{ ok: boolean; usedBytes: string }>(deleteFile, {
      method: "DELETE",
      url: `http://localhost:3000/api/files/f?id=${f.id}&hard=1`,
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    const node = await db.fileNode.findUnique({ where: { id: f.id } });
    expect(node).toBeNull();
  });

  it("restores a trashed file via PATCH", async () => {
    const f = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "f.txt",
      deletedAt: new Date(),
      deletedBy: user.id,
    });
    const { response, data } = await callRoute<{ ok: boolean }>(restoreFile, {
      method: "PATCH",
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);
    const node = await db.fileNode.findUnique({ where: { id: f.id } });
    expect(node?.deletedAt).toBeNull();
  });

  it("returns 404 when restoring a non-trashed file", async () => {
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "f.txt" });
    const { response } = await callRoute(restoreFile, {
      method: "PATCH",
      params: { id: f.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("moves a restored file to root if its parent is still trashed (ghost prevention)", async () => {
    const folder = await seedFile({
      ownerId: user.id,
      parentId: null,
      isDirectory: true,
      name: "folder",
      deletedAt: new Date(),
    });
    const file = await seedFile({
      ownerId: user.id,
      parentId: folder.id,
      name: "inside.txt",
      deletedAt: new Date(),
    });
    const { data } = await callRoute<{ movedToRoot: boolean }>(restoreFile, {
      method: "PATCH",
      params: { id: file.id },
      cookies: { doma_session: token },
    });
    expect(data!.movedToRoot).toBe(true);
    const node = await db.fileNode.findUnique({ where: { id: file.id } });
    expect(node?.parentId).toBeNull();
  });

  it("restores folder descendants that share the same deletedAt timestamp", async () => {
    const ts = new Date();
    const folder = await seedFile({
      ownerId: user.id,
      parentId: null,
      isDirectory: true,
      name: "folder",
      deletedAt: ts,
    });
    const childSame = await seedFile({
      ownerId: user.id,
      parentId: folder.id,
      name: "same.txt",
      deletedAt: ts,
    });
    const childDiff = await seedFile({
      ownerId: user.id,
      parentId: folder.id,
      name: "diff.txt",
      deletedAt: new Date(ts.getTime() - 1000), // different timestamp
    });
    await callRoute(restoreFile, {
      method: "PATCH",
      params: { id: folder.id },
      cookies: { doma_session: token },
    });
    // folder + childSame restored; childDiff stays trashed.
    const f = await db.fileNode.findUnique({ where: { id: folder.id } });
    const cs = await db.fileNode.findUnique({ where: { id: childSame.id } });
    const cd = await db.fileNode.findUnique({ where: { id: childDiff.id } });
    expect(f?.deletedAt).toBeNull();
    expect(cs?.deletedAt).toBeNull();
    expect(cd?.deletedAt).not.toBeNull();
  });
});

describe("POST /api/files/upload", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice", quotaBytes: 100n * 1024n * 1024n });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const form = new FormData();
    form.append("files", new File(["hello"], "test.txt", { type: "text/plain" }));
    const { response } = await callRoute(uploadFile, {
      method: "POST",
      formData: form,
    });
    expect(response.status).toBe(401);
  });

  it("uploads a single file successfully", async () => {
    const form = new FormData();
    form.append("files", new File(["hello world"], "test.txt", { type: "text/plain" }));
    const { response, data } = await callRoute<{ created: { id: string; name: string; sizeBytes: string }[]; usedBytes: string }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.created).toHaveLength(1);
    expect(data!.created[0].name).toBe("test.txt");
    expect(data!.created[0].sizeBytes).toBe("11");
    expect(BigInt(data!.usedBytes)).toBe(11n);
  });

  it("uploads multiple files in one request", async () => {
    const form = new FormData();
    form.append("files", new File(["aaa"], "a.txt"));
    form.append("files", new File(["bbbb"], "b.txt"));
    const { data } = await callRoute<{ created: { name: string }[] }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    expect(data!.created).toHaveLength(2);
    expect(data!.created.map((c) => c.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("computes and stores a SHA-256 hash", async () => {
    const form = new FormData();
    form.append("files", new File(["hello"], "test.txt"));
    const { data } = await callRoute<{ created: { id: string }[] }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    const node = await db.fileNode.findUnique({ where: { id: data!.created[0].id } });
    // SHA-256 of "hello"
    expect(node?.hashSha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("returns 400 when no files are provided", async () => {
    const form = new FormData();
    const { response } = await callRoute(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(400);
  });

  it("rejects upload that exceeds quota (413)", async () => {
    // Set quota to 5 bytes.
    await db.user.update({ where: { id: user.id }, data: { quotaBytes: 5n } });
    const form = new FormData();
    form.append("files", new File(["more than 5 bytes"], "big.txt"));
    const { response, data } = await callRoute<{ error: string }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(413);
    expect(data).toMatchObject({ error: expect.any(String) });
  });

  it("uploads into a specific parent folder", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "f" });
    const form = new FormData();
    form.append("files", new File(["x"], "test.txt"));
    const { data } = await callRoute<{ created: { id: string }[] }>(uploadFile, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload?parentId=${folder.id}`,
      formData: form,
      cookies: { doma_session: token },
    });
    const node = await db.fileNode.findUnique({ where: { id: data!.created[0].id } });
    expect(node?.parentId).toBe(folder.id);
  });

  it("returns 404 when the parent folder doesn't exist", async () => {
    const form = new FormData();
    form.append("files", new File(["x"], "test.txt"));
    const { response } = await callRoute(uploadFile, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload?parentId=nonexistent",
      formData: form,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("sanitizes the uploaded filename", async () => {
    const form = new FormData();
    form.append("files", new File(["x"], "../bad:name.txt"));
    const { data } = await callRoute<{ created: { name: string }[] }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    // Step 1: forbidden chars (/ and :) → _ : ".._bad_name.txt"
    // Step 2: strip leading dots: "_bad_name.txt"
    expect(data!.created[0].name).toBe("_bad_name.txt");
  });

  it("increments user.usedBytes after upload", async () => {
    const form = new FormData();
    form.append("files", new File(["hello world"], "test.txt"));
    const { data } = await callRoute<{ usedBytes: string }>(uploadFile, {
      method: "POST",
      formData: form,
      cookies: { doma_session: token },
    });
    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u?.usedBytes).toBe(BigInt(data!.usedBytes));
  });
});
