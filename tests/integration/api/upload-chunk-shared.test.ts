/**
 * Chunked upload into shared folders — session immutability + ownership.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as uploadChunk } from "@/app/api/files/upload-chunk/route";
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

function toStream(data: Uint8Array | Buffer): ReadableStream<Uint8Array> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function chunkHeaders(opts: {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkIndex: number;
  chunkTotal: number;
}): Record<string, string> {
  return {
    "x-upload-id": opts.uploadId,
    "x-file-name": encodeURIComponent(opts.fileName),
    "x-file-size": String(opts.fileSize),
    "x-file-mime": "application/octet-stream",
    "x-chunk-index": String(opts.chunkIndex),
    "x-chunk-total": String(opts.chunkTotal),
    "content-type": "application/octet-stream",
  };
}

describe("POST /api/files/upload-chunk — shared folder", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipient: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let recipientToken: string;
  let folder: { id: string };
  let share: { id: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice", usedBytes: 0n });
    recipient = await seedUser({ username: "bob" });
    recipientToken = await makeSessionToken(recipient);
    folder = await seedFile({
      ownerId: owner.id,
      isDirectory: true,
      name: "Album",
    });
    share = await seedSharedItem({
      nodeId: folder.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "upload",
    });
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("assembles a 2-chunk upload owned by the share owner", async () => {
    const part1 = Buffer.from("AAAA");
    const part2 = Buffer.from("BBBB");
    const fileSize = part1.length + part2.length;
    const uploadId = "shared-chunk-ok1";

    const first = await callRoute<{ finalized: boolean }>(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${share.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "video.bin",
        fileSize,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(part1),
      cookies: { doma_session: recipientToken },
    });
    expect(first.response.status).toBe(200);
    expect(first.data!.finalized).toBe(false);

    const last = await callRoute<{
      finalized: boolean;
      file?: { id: string; name: string };
    }>(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${share.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "video.bin",
        fileSize,
        chunkIndex: 1,
        chunkTotal: 2,
      }),
      stream: toStream(part2),
      cookies: { doma_session: recipientToken },
    });
    expect(last.response.status).toBe(200);
    expect(last.data!.finalized).toBe(true);
    expect(last.data!.file?.name).toBe("video.bin");

    const node = await db.fileNode.findUnique({
      where: { id: last.data!.file!.id },
    });
    expect(node?.ownerId).toBe(owner.id);
    expect(node?.parentId).toBe(folder.id);
    expect(Number(node?.sizeBytes)).toBe(fileSize);

    const ownerRow = await db.user.findUnique({ where: { id: owner.id } });
    expect(Number(ownerRow?.usedBytes)).toBe(fileSize);
  });

  it("rejects view-only shared chunk upload", async () => {
    await db.sharedItem.update({
      where: { id: share.id },
      data: { permission: "view" },
    });
    const { response } = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${share.id}`,
      headers: chunkHeaders({
        uploadId: "shared-chunk-view",
        fileName: "x.bin",
        fileSize: 4,
        chunkIndex: 0,
        chunkTotal: 1,
      }),
      stream: toStream(Buffer.from("xxxx")),
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(403);
  });

  it("ignores parentId hijack on later chunks (session is immutable)", async () => {
    const strangerFolder = await seedFile({
      ownerId: owner.id,
      isDirectory: true,
      name: "Elsewhere",
    });
    const part1 = Buffer.from("1111");
    const part2 = Buffer.from("2222");
    const fileSize = 8;
    const uploadId = "shared-chunk-hijack";

    const first = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${share.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "safe.bin",
        fileSize,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(part1),
      cookies: { doma_session: recipientToken },
    });
    expect(first.response.status).toBe(200);

    // Attacker tries to divert the file into another folder on chunk 1.
    const last = await callRoute<{ file?: { id: string } }>(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${share.id}&parentId=${strangerFolder.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "safe.bin",
        fileSize,
        chunkIndex: 1,
        chunkTotal: 2,
      }),
      stream: toStream(part2),
      cookies: { doma_session: recipientToken },
    });
    expect(last.response.status).toBe(200);
    const node = await db.fileNode.findUnique({
      where: { id: last.data!.file!.id },
    });
    // Must stay under the original shared root, not Elsewhere.
    expect(node?.parentId).toBe(folder.id);
  });

  it("returns 410 when sharedFolderId points at a file share", async () => {
    const file = await seedFile({ ownerId: owner.id, name: "solo.txt" });
    const fileShare = await seedSharedItem({
      nodeId: file.id,
      ownerId: owner.id,
      recipientId: recipient.id,
      permission: "edit",
    });
    const { response } = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?sharedFolderId=${fileShare.id}`,
      headers: chunkHeaders({
        uploadId: "file-share-chunk",
        fileName: "x.bin",
        fileSize: 4,
        chunkIndex: 0,
        chunkTotal: 1,
      }),
      stream: toStream(Buffer.from("xxxx")),
      cookies: { doma_session: recipientToken },
    });
    expect(response.status).toBe(410);
  });
});
