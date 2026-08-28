/**
 * Non-obvious user-flow simulations — privilege edges, restore, shared
 * upload/mkdir, public-link password retention, storage validation.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  PATCH as patchFolderShare,
  DELETE as revokeFolderShare,
} from "@/app/api/files/[id]/share-folder/[shareId]/route";
import { GET as listSharedWithMe } from "@/app/api/shares/shared-with-me/route";
import { GET as listMyShares } from "@/app/api/shares/my/route";
import { POST as uploadFile } from "@/app/api/files/upload/route";
import { POST as mkdir } from "@/app/api/files/mkdir/route";
import { PATCH as renameFile } from "@/app/api/files/[id]/rename/route";
import { DELETE as deleteFile, PATCH as restoreFile } from "@/app/api/files/[id]/route";
import { POST as createPublicShare } from "@/app/api/files/[id]/share/route";
import { PATCH as setStorageRoot } from "@/app/api/admin/storage/route";
import {
  db,
  resetDb,
  seedUser,
  seedFile,
  seedSharedItem,
  makeSessionToken,
} from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { validateStorageRoot } from "@/lib/storage/inspect";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("simulation — shared file restore + revoke", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let recipientToken: string;
  let sharedFile: { id: string; name: string; storageKey: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice" });
    recipient = await seedUser({ username: "bob" });
    ownerToken = await makeSessionToken(owner);
    recipientToken = await makeSessionToken(recipient);
    sharedFile = await seedFile({
      ownerId: owner.id,
      name: "gift.txt",
      mimeType: "text/plain",
      sizeBytes: 5n,
    });
    const storage = await (await import("@/lib/storage")).getStorage();
    await storage.put(sharedFile.storageKey, Buffer.from("hello"));
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("edit recipient can trash a shared file and restore it again", async () => {
    await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });

    const trashed = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/${sharedFile.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trashed.response.status).toBe(200);

    const restored = await callRoute(restoreFile, {
      method: "PATCH",
      params: { id: sharedFile.id },
      cookies: { doma_session: recipientToken },
    });
    expect(restored.response.status).toBe(200);

    const row = await db.fileNode.findUnique({
      where: { id: sharedFile.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeNull();
  });

  it("after revoke, recipient loses shared-with-me and download", async () => {
    const share = await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });

    const revoked = await callRoute(revokeFolderShare, {
      method: "DELETE",
      params: { id: sharedFile.id, shareId: share.id },
      cookies: { doma_session: ownerToken },
    });
    expect(revoked.response.status).toBe(200);

    const listed = await callRoute<{ items: unknown[] }>(listSharedWithMe, {
      method: "GET",
      cookies: { doma_session: recipientToken },
    });
    expect(listed.data!.items).toHaveLength(0);

    const { GET: downloadFile } = await import("@/app/api/files/download/[id]/route");
    const dl = await callRoute(downloadFile, {
      method: "GET",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/download/${sharedFile.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(dl.response.status).toBe(404);
  });

  it("PATCH share-folder rejects upload permission on a file", async () => {
    const share = await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });
    const { response } = await callRoute(patchFolderShare, {
      method: "PATCH",
      params: { id: sharedFile.id, shareId: share.id },
      body: { permission: "upload" },
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(422);
  });

  it("GET /api/shares/my lists files the owner shared", async () => {
    await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });
    const { response, data } = await callRoute<{
      items: Array<{ folderId: string; isDirectory: boolean }>;
    }>(listMyShares, {
      method: "GET",
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].folderId).toBe(sharedFile.id);
    expect(data!.items[0].isDirectory).toBe(false);
  });
});

describe("simulation — shared folder upload + mkdir", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let recipientToken: string;
  let folder: { id: string };
  let share: { id: string; nodeId: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice", usedBytes: 0n });
    recipient = await seedUser({ username: "bob" });
    ownerToken = await makeSessionToken(owner);
    recipientToken = await makeSessionToken(recipient);
    folder = await seedFile({
      ownerId: owner.id,
      isDirectory: true,
      name: "Family",
    });
    share = await seedSharedItem({
      nodeId: folder.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("edit recipient can upload; new file is owned by share owner", async () => {
    const form = new FormData();
    form.append("files", new File([Buffer.from("photo-bytes")], "pic.jpg", { type: "image/jpeg" }));

    const { response, data } = await callRoute<{
      created: Array<{ id: string; name: string }>;
    }>(uploadFile, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload?sharedFolderId=${share.id}`,
      formData: form,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.created[0].name).toBe("pic.jpg");

    const node = await db.fileNode.findUnique({ where: { id: data!.created[0].id } });
    expect(node?.ownerId).toBe(owner.id);
    expect(node?.parentId).toBe(folder.id);

    const ownerRow = await db.user.findUnique({ where: { id: owner.id } });
    expect(Number(ownerRow?.usedBytes)).toBeGreaterThan(0);
  });

  it("view recipient cannot upload into shared folder", async () => {
    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "view" },
    });
    const form = new FormData();
    form.append("files", new File([Buffer.from("x")], "x.txt"));
    const { response } = await callRoute(uploadFile, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload?sharedFolderId=${share.id}`,
      formData: form,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });

  it("upload into a file-share id returns 410", async () => {
    const file = await seedFile({ ownerId: owner.id, name: "solo.txt" });
    const fileShare = await seedSharedItem({
      nodeId: file.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });
    const form = new FormData();
    form.append("files", new File([Buffer.from("x")], "x.txt"));
    const { response } = await callRoute(uploadFile, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload?sharedFolderId=${fileShare.id}`,
      formData: form,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(410);
  });

  it("mkdir requires edit; upload permission is not enough", async () => {
    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "upload" },
    });
    const denied = await callRoute(mkdir, {
      method: "POST",
      url: `http://localhost:3000/api/files/mkdir?sharedFolderId=${share.id}`,
      body: { name: "Sub" },
      cookies: { doma_session: recipientToken },
    });
    expect(denied.response.status).toBe(403);

    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "edit" },
    });
    const ok = await callRoute<{ id: string; name: string }>(mkdir, {
      method: "POST",
      url: `http://localhost:3000/api/files/mkdir?sharedFolderId=${share.id}`,
      body: { name: "Sub" },
      cookies: { doma_session: recipientToken },
    });
    expect(ok.response.status).toBe(200);
    expect(ok.data!.name).toBe("Sub");
    const created = await db.fileNode.findUnique({ where: { id: ok.data!.id } });
    expect(created?.ownerId).toBe(owner.id);
  });

  it("recipient cannot rename or trash the shared folder root", async () => {
    const rename = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: folder.id },
      body: { name: "Hijacked" },
      cookies: { doma_session: recipientToken },
    });
    expect(rename.response.status).toBe(403);

    const trash = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: folder.id },
      url: `http://localhost:3000/api/files/${folder.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trash.response.status).toBe(403);
  });

  it("hard delete by recipient is refused (owner-only)", async () => {
    const child = await seedFile({
      ownerId: owner.id,
      parentId: folder.id,
      name: "inside.txt",
    });
    const { response } = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: child.id },
      url: `http://localhost:3000/api/files/${child.id}?hard=1`,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(404);
  });
});

describe("simulation — public link password retention", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;
  let fileId: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
    const f = await seedFile({ ownerId: user.id, name: "secret.jpg" });
    fileId = f.id;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("updating link settings without password keeps the existing hash", async () => {
    const created = await callRoute<{ token: string }>(createPublicShare, {
      method: "POST",
      params: { id: fileId },
      body: { password: "family-secret", label: "first" },
      cookies: { doma_session: token },
    });
    expect(created.response.status).toBe(200);

    const before = await db.share.findFirst({ where: { nodeId: fileId } });
    expect(before?.passwordHash).toBeTruthy();

    const updated = await callRoute<{ updated?: boolean }>(createPublicShare, {
      method: "POST",
      params: { id: fileId },
      // password omitted — JSON will not include the key
      body: { label: "updated-label", maxViews: 5 },
      cookies: { doma_session: token },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.data!.updated).toBe(true);

    const after = await db.share.findFirst({ where: { nodeId: fileId } });
    expect(after?.passwordHash).toBe(before!.passwordHash);
    expect(after?.label).toBe("updated-label");
    expect(after?.maxViews).toBe(5);
  });

  it("explicit empty password clears protection", async () => {
    await callRoute(createPublicShare, {
      method: "POST",
      params: { id: fileId },
      body: { password: "x" },
      cookies: { doma_session: token },
    });
    await callRoute(createPublicShare, {
      method: "POST",
      params: { id: fileId },
      body: { password: "" },
      cookies: { doma_session: token },
    });
    const after = await db.share.findFirst({ where: { nodeId: fileId } });
    expect(after?.passwordHash).toBeNull();
  });

  it("recipient cannot create a public link on a file they only ACL-see", async () => {
    const owner = await seedUser({ username: "owner" });
    const bob = await seedUser({ username: "bob2" });
    const bobToken = await makeSessionToken(bob);
    const f = await seedFile({ ownerId: owner.id, name: "private.txt" });
    await seedSharedItem({
      nodeId: f.id,
      ownerId: owner.id,
      recipientId: bob.id,
      permission: "edit",
    });
    const { response } = await callRoute(createPublicShare, {
      method: "POST",
      params: { id: f.id },
      body: {},
      cookies: { doma_session: bobToken },
    });
    expect(response.status).toBe(404);
  });
});

describe("simulation — storage root validation", () => {
  it("rejects relative paths", async () => {
    await expect(validateStorageRoot("storage-data")).rejects.toThrow(/абсолютн/i);
  });

  it("rejects system roots", async () => {
    if (process.platform === "win32") {
      // Drive roots and top-level system folders are forbidden.
      await expect(validateStorageRoot("C:\\")).rejects.toThrow(/системн/i);
      await expect(validateStorageRoot("C:\\Windows\\temp")).rejects.toThrow(/системн/i);
    } else {
      await expect(validateStorageRoot("/")).rejects.toThrow(/системн/i);
      await expect(validateStorageRoot("/etc")).rejects.toThrow(/системн/i);
    }
  });

  it("creates a missing leaf when parent exists", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "doma-stor-"));
    const leaf = path.join(parent, "doma-storage");
    try {
      const validated = await validateStorageRoot(leaf);
      expect(validated).toBe(path.resolve(leaf));
      const st = await fs.stat(leaf);
      expect(st.isDirectory()).toBe(true);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects when path is a file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doma-stor-"));
    const file = path.join(dir, "not-a-dir");
    await fs.writeFile(file, "x");
    try {
      await expect(validateStorageRoot(file)).rejects.toThrow(/не директория/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("admin storage PATCH rejects relative path", async () => {
    await resetDb();
    resetMockCookies();
    const admin = await seedUser({ username: "admin", role: "admin" });
    const token = await makeSessionToken(admin);
    const { response, data } = await callRoute<{ error: string }>(setStorageRoot, {
      method: "PATCH",
      body: { storageLocalRoot: "relative/path" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
    expect(data!.error).toMatch(/абсолютн/i);
  });
});
