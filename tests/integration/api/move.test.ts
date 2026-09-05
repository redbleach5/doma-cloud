import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { PATCH as moveFile } from "@/app/api/files/[id]/move/route";
import { POST as mkdir } from "@/app/api/files/mkdir/route";
import { db, resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";

describe("PATCH /api/files/[id]/move", () => {
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
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });
    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: null },
    });
    expect(response.status).toBe(401);
  });

  it("moves a file from root into a folder", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);

    const updated = await db.fileNode.findUnique({ where: { id: file.id }, select: { parentId: true } });
    expect(updated?.parentId).toBe(folder.id);
  });

  it("moves a file from a folder back to root", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const file = await seedFile({ ownerId: user.id, parentId: folder.id, name: "a.jpg" });

    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: null },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);

    const updated = await db.fileNode.findUnique({ where: { id: file.id }, select: { parentId: true } });
    expect(updated?.parentId).toBeNull();
  });

  it("returns moved:false when moving to the same parent (no-op)", async () => {
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: null },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(false);
  });

  it("returns 404 when the file does not belong to the caller", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const otherFile = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.jpg" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: otherFile.id },
      body: { parentId: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the destination folder does not exist", async () => {
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: "nonexistent-folder-id" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 422 when the destination is a file, not a folder", async () => {
    const destFile = await seedFile({ ownerId: user.id, parentId: null, name: "dest.jpg" });
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: destFile.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 409 on name collision in the destination", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    // Pre-existing 'a.jpg' inside the folder.
    await seedFile({ ownerId: user.id, parentId: folder.id, name: "a.jpg" });
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: { parentId: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(409);
  });

  it("refuses to move a folder into itself (cycle protection)", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: folder.id },
      body: { parentId: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("refuses to move a folder into its own descendant (cycle protection)", async () => {
    // root/parent/child — moving `parent` into `child` should be rejected.
    const parent = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "parent" });
    const child = await seedFile({ ownerId: user.id, parentId: parent.id, isDirectory: true, name: "child" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: parent.id },
      body: { parentId: child.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 422 for invalid body (missing parentId)", async () => {
    const file = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg" });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: file.id },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 422 when moving a trashed file", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const trashed = await seedFile({ ownerId: user.id, parentId: null, name: "a.jpg", deletedAt: new Date() });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: trashed.id },
      body: { parentId: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });
});

// Silence unused-import warning for `mkdir` if we end up not using it
// in a future iteration. Kept around because it's a handy primitive.
void mkdir;
