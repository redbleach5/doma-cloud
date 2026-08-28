import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GET as listFiles } from "@/app/api/files/list/route";
import { GET as listSharedWithMe } from "@/app/api/shares/shared-with-me/route";
import { PATCH as moveFile } from "@/app/api/files/[id]/move/route";
import { POST as shareNode, GET as listNodeShares } from "@/app/api/files/[id]/share-folder/route";
import { PATCH as renameFile } from "@/app/api/files/[id]/rename/route";
import { DELETE as deleteFile } from "@/app/api/files/[id]/route";
import { GET as downloadFile } from "@/app/api/files/download/[id]/route";
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
import { getStorage } from "@/lib/storage";

describe("shared folders — browse + move", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let stranger: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let recipientToken: string;
  let strangerToken: string;
  let sharedRoot: { id: string; name: string };
  let childFolder: { id: string; name: string };
  let childFile: { id: string; name: string };
  let share: { id: string; nodeId: string };

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

    // owner/Photos/Vacation/shot.jpg
    sharedRoot = await seedFile({
      ownerId: owner.id,
      parentId: null,
      isDirectory: true,
      name: "Photos",
    });
    childFolder = await seedFile({
      ownerId: owner.id,
      parentId: sharedRoot.id,
      isDirectory: true,
      name: "Vacation",
    });
    childFile = await seedFile({
      ownerId: owner.id,
      parentId: sharedRoot.id,
      name: "shot.jpg",
      mimeType: "image/jpeg",
    });

    share = await seedSharedItem({
      nodeId: sharedRoot.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  // ---- shared-with-me ----------------------------------------------------

  it("lists shared folders for the recipient with SharedItem.id", async () => {
    const { response, data } = await callRoute<{
      items: Array<{ id: string; folderId: string; folderName: string; permission: string; isDirectory: boolean }>;
    }>(listSharedWithMe, {
      method: "GET",
      url: "http://localhost:3000/api/shares/shared-with-me",
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].id).toBe(share.id);
    expect(data!.items[0].folderId).toBe(sharedRoot.id);
    expect(data!.items[0].folderName).toBe("Photos");
    expect(data!.items[0].permission).toBe("edit");
    expect(data!.items[0].isDirectory).toBe(true);
  });

  it("does not list shares for a stranger", async () => {
    const { response, data } = await callRoute<{ items: unknown[] }>(listSharedWithMe, {
      method: "GET",
      url: "http://localhost:3000/api/shares/shared-with-me",
      cookies: { doma_session: strangerToken },
    });
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(0);
  });

  // ---- list with sharedFolderId ------------------------------------------

  it("lists children when sharedFolderId is the SharedItem.id", async () => {
    const { response, data } = await callRoute<{
      items: Array<{ id: string; name: string; isShared?: boolean; permission?: string }>;
    }>(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?sharedFolderId=${share.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    const names = data!.items.map((i) => i.name).sort();
    expect(names).toEqual(["Vacation", "shot.jpg"]);
    expect(data!.items.every((i) => i.isShared === true)).toBe(true);
    expect(data!.items.every((i) => i.permission === "edit")).toBe(true);
  });

  it("returns 404 when sharedFolderId is the folderId (not SharedItem.id)", async () => {
    const { response } = await callRoute(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?sharedFolderId=${sharedRoot.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when a stranger uses a valid SharedItem.id", async () => {
    const { response } = await callRoute(listFiles, {
      method: "GET",
      url: `http://localhost:3000/api/files/list?sharedFolderId=${share.id}`,
      cookies: { doma_session: strangerToken },
    });
    expect(response.status).toBe(404);
  });

  it("lists a nested shared folder by parentId", async () => {
    const nested = await seedFile({
      ownerId: owner.id,
      parentId: childFolder.id,
      name: "nested.txt",
      mimeType: "text/plain",
    });

    const { response, data } = await callRoute<{ items: Array<{ id: string; name: string }> }>(
      listFiles,
      {
        method: "GET",
        url: `http://localhost:3000/api/files/list?sharedFolderId=${share.id}&parentId=${childFolder.id}`,
        cookies: { doma_session: recipientToken },
      }
    );
    expect(response.status).toBe(200);
    expect(data!.items.map((i) => i.id)).toContain(nested.id);
  });

  // ---- move inside shared folder -----------------------------------------

  it("lets an edit recipient move a file into a subfolder", async () => {
    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: childFolder.id, sharedFolderId: share.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);

    const updated = await db.fileNode.findUnique({
      where: { id: childFile.id },
      select: { parentId: true },
    });
    expect(updated?.parentId).toBe(childFolder.id);
  });

  it("lets an upload recipient cut/paste (move) inside the share", async () => {
    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "upload" },
    });

    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: childFolder.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);
  });

  it("rejects move for a view-only recipient", async () => {
    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "view" },
    });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: childFolder.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });

  it("refuses to move the share root itself", async () => {
    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: sharedRoot.id },
      body: { parentId: childFolder.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });

  it("refuses to move a shared node outside the share (to another user's folder)", async () => {
    const strangerFolder = await seedFile({
      ownerId: stranger.id,
      parentId: null,
      isDirectory: true,
      name: "Elsewhere",
    });

    const { response } = await callRoute(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: strangerFolder.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });

  it("maps parentId=null to the share root for recipients", async () => {
    await db.fileNode.update({
      where: { id: childFile.id },
      data: { parentId: childFolder.id },
    });

    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: null, sharedFolderId: share.id },
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);

    const updated = await db.fileNode.findUnique({
      where: { id: childFile.id },
      select: { parentId: true },
    });
    expect(updated?.parentId).toBe(sharedRoot.id);
  });

  it("still lets the owner move freely (owner path unchanged)", async () => {
    const { response, data } = await callRoute<{ ok: boolean; moved: boolean }>(moveFile, {
      method: "PATCH",
      params: { id: childFile.id },
      body: { parentId: childFolder.id },
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(200);
    expect(data!.moved).toBe(true);
  });
});

describe("shared files — user ACL", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let stranger: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let recipientToken: string;
  let strangerToken: string;
  let sharedFile: { id: string; name: string; storageKey: string };

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

    sharedFile = await seedFile({
      ownerId: owner.id,
      parentId: null,
      name: "memo.txt",
      mimeType: "text/plain",
      sizeBytes: 12n,
    });
    const storage = await getStorage();
    await storage.put(sharedFile.storageKey, Buffer.from("hello family"));
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("shares a file → appears in shared-with-me for recipient", async () => {
    const { response: shareRes, data: shareData } = await callRoute<{
      id: string;
      permission: string;
    }>(shareNode, {
      method: "POST",
      params: { id: sharedFile.id },
      body: { recipientUsername: "bob", permission: "view" },
      cookies: { doma_session: ownerToken },
    });
    expect(shareRes.status).toBe(200);
    expect(shareData!.permission).toBe("view");

    const { response, data } = await callRoute<{
      items: Array<{ id: string; folderId: string; folderName: string; isDirectory: boolean; mimeType: string }>;
    }>(listSharedWithMe, {
      method: "GET",
      url: "http://localhost:3000/api/shares/shared-with-me",
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(1);
    expect(data!.items[0].id).toBe(shareData!.id);
    expect(data!.items[0].folderId).toBe(sharedFile.id);
    expect(data!.items[0].folderName).toBe("memo.txt");
    expect(data!.items[0].isDirectory).toBe(false);
    expect(data!.items[0].mimeType).toBe("text/plain");
  });

  it("rejects upload permission on a file", async () => {
    const { response } = await callRoute(shareNode, {
      method: "POST",
      params: { id: sharedFile.id },
      body: { recipientUsername: "bob", permission: "upload" },
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(422);
  });

  it("upserts when sharing the same file with the same user again", async () => {
    const first = await callRoute<{ id: string; permission: string }>(shareNode, {
      method: "POST",
      params: { id: sharedFile.id },
      body: { recipientUsername: "bob", permission: "view" },
      cookies: { doma_session: ownerToken },
    });
    expect(first.response.status).toBe(200);

    const second = await callRoute<{ id: string; permission: string }>(shareNode, {
      method: "POST",
      params: { id: sharedFile.id },
      body: { recipientUsername: "bob", permission: "edit" },
      cookies: { doma_session: ownerToken },
    });
    expect(second.response.status).toBe(200);
    expect(second.data!.id).toBe(first.data!.id);
    expect(second.data!.permission).toBe("edit");

    const listed = await callRoute<{ shares: Array<{ id: string; permission: string }> }>(
      listNodeShares,
      {
        method: "GET",
        params: { id: sharedFile.id },
        cookies: { doma_session: ownerToken },
      }
    );
    expect(listed.response.status).toBe(200);
    expect(listed.data!.shares).toHaveLength(1);
    expect(listed.data!.shares[0].permission).toBe("edit");
  });

  it("lets the recipient download; stranger gets 404", async () => {
    await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });

    const ok = await callRoute(downloadFile, {
      method: "GET",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/download/${sharedFile.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(ok.response.status).toBe(200);

    const denied = await callRoute(downloadFile, {
      method: "GET",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/download/${sharedFile.id}`,
      cookies: { doma_session: strangerToken },
    });
    expect(denied.response.status).toBe(404);
  });

  it("edit allows rename + trash; view does not", async () => {
    const share = await seedSharedItem({
      nodeId: sharedFile.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "view",
    });

    const renameDenied = await callRoute(renameFile, {
      method: "PATCH",
      params: { id: sharedFile.id },
      body: { name: "renamed.txt" },
      cookies: { doma_session: recipientToken },
    });
    expect(renameDenied.response.status).toBe(403);

    const trashDenied = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/${sharedFile.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trashDenied.response.status).toBe(403);

    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "edit" },
    });

    const renamed = await callRoute<{ ok: boolean; name: string }>(renameFile, {
      method: "PATCH",
      params: { id: sharedFile.id },
      body: { name: "renamed.txt" },
      cookies: { doma_session: recipientToken },
    });
    expect(renamed.response.status).toBe(200);
    expect(renamed.data!.name).toBe("renamed.txt");

    const trashed = await callRoute(deleteFile, {
      method: "DELETE",
      params: { id: sharedFile.id },
      url: `http://localhost:3000/api/files/${sharedFile.id}`,
      cookies: { doma_session: recipientToken },
    });
    expect(trashed.response.status).toBe(200);

    const row = await db.fileNode.findUnique({
      where: { id: sharedFile.id },
      select: { deletedAt: true, name: true },
    });
    expect(row?.name).toBe("renamed.txt");
    expect(row?.deletedAt).not.toBeNull();
  });
});
