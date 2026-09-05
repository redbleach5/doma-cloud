/**
 * Owner path for chunked uploads — finalize, resume, abort, uploadId
 * validation, and quota.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { POST as uploadChunk, DELETE as abortChunk } from "@/app/api/files/upload-chunk/route";
import {
  db,
  resetDb,
  seedUser,
  seedFile,
  makeSessionToken,
} from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { getStorage } from "@/lib/storage";

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
  mime?: string;
}): Record<string, string> {
  return {
    "x-upload-id": opts.uploadId,
    "x-file-name": encodeURIComponent(opts.fileName),
    "x-file-size": String(opts.fileSize),
    "x-file-mime": opts.mime ?? "application/octet-stream",
    "x-chunk-index": String(opts.chunkIndex),
    "x-chunk-total": String(opts.chunkTotal),
    "content-type": "application/octet-stream",
  };
}

describe("POST/DELETE /api/files/upload-chunk — owner", () => {
  let owner: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let ownerToken: string;
  let folder: { id: string };

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    owner = await seedUser({ username: "alice", usedBytes: 0n });
    ownerToken = await makeSessionToken(owner);
    folder = await seedFile({
      ownerId: owner.id,
      isDirectory: true,
      name: "Inbox",
    });
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("assembles a 3-chunk owner upload into a folder with correct size and hash", async () => {
    const parts = [Buffer.from("AAA"), Buffer.from("BBBB"), Buffer.from("CC")];
    const fileSize = parts.reduce((n, p) => n + p.length, 0);
    const uploadId = "owner-chunk-3";
    const expectedHash = createHash("sha256")
      .update(Buffer.concat(parts))
      .digest("hex");

    for (let i = 0; i < parts.length; i++) {
      const result = await callRoute<{
        finalized: boolean;
        file?: { id: string; name: string };
      }>(uploadChunk, {
        method: "POST",
        url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
        headers: chunkHeaders({
          uploadId,
          fileName: "big.bin",
          fileSize,
          chunkIndex: i,
          chunkTotal: 3,
        }),
        stream: toStream(parts[i]!),
        cookies: { doma_session: ownerToken },
      });
      expect(result.response.status).toBe(200);
      if (i < 2) {
        expect(result.data!.finalized).toBe(false);
      } else {
        expect(result.data!.finalized).toBe(true);
        expect(result.data!.file?.name).toBe("big.bin");

        const node = await db.fileNode.findUnique({
          where: { id: result.data!.file!.id },
        });
        expect(node?.ownerId).toBe(owner.id);
        expect(node?.parentId).toBe(folder.id);
        expect(Number(node?.sizeBytes)).toBe(fileSize);
        expect(node?.hashSha256).toBe(expectedHash);

        const storage = await getStorage();
        const buf = await storage.getBuffer(node!.storageKey);
        expect(Buffer.compare(buf, Buffer.concat(parts))).toBe(0);

        const user = await db.user.findUnique({ where: { id: owner.id } });
        expect(Number(user?.usedBytes)).toBe(fileSize);
      }
    }
  });

  it("resumes after chunk 0 rewrite and finalizes with matching bytes", async () => {
    const part1a = Buffer.from("XXXX");
    const part1b = Buffer.from("AAAA");
    const part2 = Buffer.from("BBBB");
    const fileSize = 8;
    const uploadId = "owner-resume-1";

    const first = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "resume.bin",
        fileSize,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(part1a),
      cookies: { doma_session: ownerToken },
    });
    expect(first.response.status).toBe(200);

    // Client re-sends chunk 0 after a glitch (same uploadId).
    const retry = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "resume.bin",
        fileSize,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(part1b),
      cookies: { doma_session: ownerToken },
    });
    expect(retry.response.status).toBe(200);

    const last = await callRoute<{ finalized: boolean; file?: { id: string } }>(
      uploadChunk,
      {
        method: "POST",
        url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
        headers: chunkHeaders({
          uploadId,
          fileName: "resume.bin",
          fileSize,
          chunkIndex: 1,
          chunkTotal: 2,
        }),
        stream: toStream(part2),
        cookies: { doma_session: ownerToken },
      }
    );
    expect(last.response.status).toBe(200);
    expect(last.data!.finalized).toBe(true);

    const node = await db.fileNode.findUnique({
      where: { id: last.data!.file!.id },
    });
    const storage = await getStorage();
    const buf = await storage.getBuffer(node!.storageKey);
    expect(Buffer.compare(buf, Buffer.concat([part1b, part2]))).toBe(0);
  });

  it("DELETE aborts an in-progress upload so later chunks get 410", async () => {
    const uploadId = "owner-abort-1";
    const first = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "abort.bin",
        fileSize: 8,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(Buffer.from("AAAA")),
      cookies: { doma_session: ownerToken },
    });
    expect(first.response.status).toBe(200);

    const aborted = await callRoute(abortChunk, {
      method: "DELETE",
      url: `http://localhost:3000/api/files/upload-chunk?uploadId=${uploadId}`,
      cookies: { doma_session: ownerToken },
    });
    expect(aborted.response.status).toBe(200);

    const after = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId,
        fileName: "abort.bin",
        fileSize: 8,
        chunkIndex: 1,
        chunkTotal: 2,
      }),
      stream: toStream(Buffer.from("BBBB")),
      cookies: { doma_session: ownerToken },
    });
    expect(after.response.status).toBe(410);
  });

  it("rejects path-traversal and invalid uploadId on POST and DELETE", async () => {
    const badPost = await callRoute(uploadChunk, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload-chunk",
      headers: chunkHeaders({
        uploadId: "../../etc",
        fileName: "x.bin",
        fileSize: 4,
        chunkIndex: 0,
        chunkTotal: 1,
      }),
      stream: toStream(Buffer.from("xxxx")),
      cookies: { doma_session: ownerToken },
    });
    expect(badPost.response.status).toBe(400);

    const badDelete = await callRoute(abortChunk, {
      method: "DELETE",
      url: "http://localhost:3000/api/files/upload-chunk?uploadId=../../etc",
      cookies: { doma_session: ownerToken },
    });
    expect(badDelete.response.status).toBe(400);
  });

  it("returns 413 when the file would exceed the owner quota", async () => {
    await db.user.update({
      where: { id: owner.id },
      data: { quotaBytes: 10n, usedBytes: 0n },
    });
    const { response } = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId: "owner-quota-1",
        fileName: "too-big.bin",
        fileSize: 64,
        chunkIndex: 0,
        chunkTotal: 1,
      }),
      stream: toStream(Buffer.alloc(64, 0xab)),
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(413);
  });

  it("returns 410 when chunk 1 arrives with no prior session", async () => {
    const { response } = await callRoute(uploadChunk, {
      method: "POST",
      url: `http://localhost:3000/api/files/upload-chunk?parentId=${folder.id}`,
      headers: chunkHeaders({
        uploadId: "orphan-chunk-1",
        fileName: "orphan.bin",
        fileSize: 8,
        chunkIndex: 1,
        chunkTotal: 2,
      }),
      stream: toStream(Buffer.from("BBBB")),
      cookies: { doma_session: ownerToken },
    });
    expect(response.status).toBe(410);
  });
});
