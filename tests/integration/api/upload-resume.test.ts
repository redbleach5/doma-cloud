/**
 * Upload resume status API + nextChunkIndex helper logic.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  POST as uploadChunk,
  GET as uploadStatus,
  DELETE as abortChunk,
} from "@/app/api/files/upload-chunk/route";
import {
  db,
  resetDb,
  seedUser,
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

describe("GET /api/files/upload-chunk — resume status", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    const user = await seedUser({ username: "resumer" });
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 410 when the session does not exist", async () => {
    const { response } = await callRoute(uploadStatus, {
      method: "GET",
      url: "http://localhost:3000/api/files/upload-chunk?uploadId=missing-id",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(410);
  });

  it("reports received chunks and nextChunkIndex after partial upload", async () => {
    const part1 = Buffer.from("AAAA");
    const part2 = Buffer.from("BBBB");
    const fileSize = 8;
    const uploadId = "resume-status-1";

    const first = await callRoute(uploadChunk, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload-chunk",
      headers: chunkHeaders({
        uploadId,
        fileName: "big.bin",
        fileSize,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(part1),
      cookies: { doma_session: token },
    });
    expect(first.response.status).toBe(200);

    const { response, data } = await callRoute<{
      exists: boolean;
      receivedChunks: number[];
      nextChunkIndex: number;
      fileName: string;
      fileSize: number;
      chunkSize: number | null;
    }>(uploadStatus, {
      method: "GET",
      url: `http://localhost:3000/api/files/upload-chunk?uploadId=${uploadId}`,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.exists).toBe(true);
    expect(data!.receivedChunks).toEqual([0]);
    expect(data!.nextChunkIndex).toBe(1);
    expect(data!.fileName).toBe("big.bin");
    expect(data!.fileSize).toBe(fileSize);
    // chunk-0 is "AAAA" (4 bytes) — the client needs this to resume a session
    // with matching offsets after a client-side CHUNK_SIZE change.
    expect(data!.chunkSize).toBe(part1.length);

    // Finish with chunk 1 — should resume cleanly.
    const last = await callRoute<{ finalized: boolean }>(uploadChunk, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload-chunk",
      headers: chunkHeaders({
        uploadId,
        fileName: "big.bin",
        fileSize,
        chunkIndex: 1,
        chunkTotal: 2,
      }),
      stream: toStream(part2),
      cookies: { doma_session: token },
    });
    expect(last.response.status).toBe(200);
    expect(last.data!.finalized).toBe(true);

    const gone = await callRoute(uploadStatus, {
      method: "GET",
      url: `http://localhost:3000/api/files/upload-chunk?uploadId=${uploadId}`,
      cookies: { doma_session: token },
    });
    expect(gone.response.status).toBe(410);
  });

  it("returns 400 for a malicious uploadId", async () => {
    const { response } = await callRoute(uploadStatus, {
      method: "GET",
      url: "http://localhost:3000/api/files/upload-chunk?uploadId=../../etc",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(400);
  });

  it("abort removes the session so status becomes 410", async () => {
    const uploadId = "resume-abort-1";
    await callRoute(uploadChunk, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload-chunk",
      headers: chunkHeaders({
        uploadId,
        fileName: "x.bin",
        fileSize: 8,
        chunkIndex: 0,
        chunkTotal: 2,
      }),
      stream: toStream(Buffer.from("AAAA")),
      cookies: { doma_session: token },
    });
    await callRoute(abortChunk, {
      method: "DELETE",
      url: `http://localhost:3000/api/files/upload-chunk?uploadId=${uploadId}`,
      cookies: { doma_session: token },
    });
    const { response } = await callRoute(uploadStatus, {
      method: "GET",
      url: `http://localhost:3000/api/files/upload-chunk?uploadId=${uploadId}`,
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(410);
    expect(await db.fileNode.count()).toBe(0);
  });
});
