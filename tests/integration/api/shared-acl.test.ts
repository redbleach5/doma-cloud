/**
 * Next-wave edge checks: thumbnail ACL, demoted-admin session, restore
 * inside a shared folder (not only direct file ACL).
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GET as thumbnail } from "@/app/api/files/thumbnail/[id]/route";
import { GET as adminStats } from "@/app/api/admin/stats/route";
import { DELETE as deleteFile, PATCH as restoreFile } from "@/app/api/files/[id]/route";
import { PATCH as renameFile } from "@/app/api/files/[id]/rename/route";
import {
  db,
  resetDb,
  seedUser,
  seedFile,
  seedShare,
  seedSharedItem,
  makeSessionToken,
} from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { getStorage } from "@/lib/storage";
import { shareVerifiedCookieKey, shareViewedCookieKey } from "@/lib/auth/share-cookie";
import { hashPassword } from "@/lib/auth/password";

/** Minimal valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("GET /api/files/thumbnail/[id] — ACL", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let stranger: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let recipientToken: string;
  let strangerToken: string;
  let image: { id: string; storageKey: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice" });
    recipient = await seedUser({ username: "bob" });
    stranger = await seedUser({ username: "carol" });
    ownerToken = await makeSessionToken(owner);
    recipientToken = await makeSessionToken(recipient);
    strangerToken = await makeSessionToken(stranger);

    image = await seedFile({
      ownerId: owner.id,
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: BigInt(PNG_1X1.length),
    });
    const storage = await getStorage();
    await storage.put(image.storageKey, PNG_1X1);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("lets the owner fetch a thumbnail", async () => {
    const { response } = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("private");
  });

  it("serves from disk cache on second request and honors If-None-Match", async () => {
    const miss = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: ownerToken },
    });
    expect(miss.response.status).toBe(200);
    expect(miss.response.headers.get("X-Thumb-Cache")).toBe("MISS");
    const etag = miss.response.headers.get("ETag");
    expect(etag).toBeTruthy();

    const hit = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: ownerToken },
    });
    expect(hit.response.status).toBe(200);
    expect(hit.response.headers.get("X-Thumb-Cache")).toBe("HIT");
    expect(hit.response.headers.get("ETag")).toBe(etag);

    const notModified = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: ownerToken },
      headers: { "if-none-match": etag! },
    });
    expect(notModified.response.status).toBe(304);
  });

  it("lets an ACL recipient fetch a thumbnail; stranger gets 404", async () => {
    await seedSharedItem({
      nodeId: image.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });

    const ok = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: recipientToken },
    });
    expect(ok.response.status).toBe(200);

    const denied = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=64`,
      cookies: { doma_session: strangerToken },
    });
    expect(denied.response.status).toBe(404);
  });

  it("serves thumbnail via share token with viewed cookie; uses no-store cache", async () => {
    const share = await seedShare({
      nodeId: image.id,
      createdBy: owner.id,
      token: "thumb-tok-1",
      maxViews: 5,
      usedCount: 1,
    });

    const blocked = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?token=${share.token}&size=64`,
    });
    expect(blocked.response.status).toBe(403);

    const ok = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?token=${share.token}&size=64`,
      cookies: { [shareViewedCookieKey(share.token)]: "1" },
    });
    expect(ok.response.status).toBe(200);
    expect(ok.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("requires verified-password cookie for password-protected share thumbnails", async () => {
    const share = await seedShare({
      nodeId: image.id,
      createdBy: owner.id,
      token: "thumb-pw-1",
      passwordHash: await hashPassword("secret"),
    });

    const needsPw = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?token=${share.token}&size=64`,
    });
    expect(needsPw.response.status).toBe(401);

    const ok = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?token=${share.token}&size=64`,
      cookies: { [shareVerifiedCookieKey(share.token)]: "1" },
    });
    expect(ok.response.status).toBe(200);
  });

  it("returns 404 for non-image mime types", async () => {
    const txt = await seedFile({
      ownerId: owner.id,
      name: "note.txt",
      mimeType: "text/plain",
    });
    const { response } = await callRoute(thumbnail, {
      method: "GET",
      params: { id: txt.id },
      url: `http://localhost:3000/api/files/thumbnail/${txt.id}`,
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(404);
  });

  it("rasterizes SVG to JPEG (download forces attachment; grid/preview need a thumb)", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
    );
    const node = await seedFile({
      ownerId: owner.id,
      name: "icon.svg",
      mimeType: "image/svg+xml",
      sizeBytes: BigInt(svg.length),
    });
    const storage = await getStorage();
    await storage.put(node.storageKey, svg);

    // callRoute consumes the body via .json() — invoke the handler directly.
    const { buildRequest } = await import("../../helpers/mock-request");
    const req = buildRequest({
      method: "GET",
      url: `http://localhost:3000/api/files/thumbnail/${node.id}?size=64`,
      cookies: { doma_session: ownerToken },
    });
    const response = await thumbnail(req, { params: Promise.resolve({ id: node.id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(32);
    // JPEG SOI marker
    expect(body[0]).toBe(0xff);
    expect(body[1]).toBe(0xd8);
  });

  it("accepts size=2048 for full-screen transcoded previews", async () => {
    const { response } = await callRoute(thumbnail, {
      method: "GET",
      params: { id: image.id },
      url: `http://localhost:3000/api/files/thumbnail/${image.id}?size=2048`,
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });
});

describe("admin session after demotion", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
  });

  it("denies admin routes when JWT still says admin but DB role is user", async () => {
    // Two admins so demotion of one is allowed by product rules.
    const a1 = await seedUser({ username: "admin1", role: "admin" });
    await seedUser({ username: "admin2", role: "admin" });
    const token = await makeSessionToken(a1); // role: admin baked in

    await db.user.update({ where: { id: a1.id }, data: { role: "user" } });

    const { response } = await callRoute(adminStats, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(403);
  });
});

describe("shared folder — rename/trash root vs restore child", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipientToken: string;
  let folder: { id: string };
  let child: { id: string; name: string; storageKey: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice" });
    recipient = await seedUser({ username: "bob" });
    recipientToken = await makeSessionToken(recipient);
    folder = await seedFile({
      ownerId: owner.id,
      isDirectory: true,
      name: "SharedRoot",
    });
    child = await seedFile({
      ownerId: owner.id,
      parentId: folder.id,
      name: "inside.txt",
      mimeType: "text/plain",
      sizeBytes: 4n,
    });
    const storage = await getStorage();
    await storage.put(child.storageKey, Buffer.from("abcd"));

    await seedSharedItem({
      nodeId: folder.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("blocks rename/trash of shared folder root; allows restore of trashed child", async () => {
    const renameRoot = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: folder.id },
      body: { name: "Hijack" },
      cookies: { doma_session: recipientToken },
    });
    expect(renameRoot.response.status).toBe(403);

    const trashRoot = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: folder.id },
      url: `http://localhost:3000/api/files/${folder.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trashRoot.response.status).toBe(403);

    const trashChild = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: child.id },
      url: `http://localhost:3000/api/files/${child.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trashChild.response.status).toBe(200);

    const restore = await callRoute(restoreFile, {
      method: "PATCH",
      params: { id: child.id },
      cookies: { doma_session: recipientToken },
    });
    expect(restore.response.status).toBe(200);

    const row = await db.fileNode.findUnique({
      where: { id: child.id },
      select: { deletedAt: true, parentId: true },
    });
    expect(row?.deletedAt).toBeNull();
    expect(row?.parentId).toBe(folder.id);
  });

  it("view recipient cannot trash a child inside the share", async () => {
    await db.sharedItem.updateMany({
      where: { nodeId: folder.id, recipientId: recipient.id },
      data: { permission: "view" },
    });
    const { response } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: child.id },
      url: `http://localhost:3000/api/files/${child.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });
});
