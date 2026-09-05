/**
 * Scale-resilience unit checks for chunk finalize quota races and
 * separated upload / upload-chunk rate-limit buckets.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as uploadChunk } from "@/app/api/files/upload-chunk/route";
import {
  db,
  resetDb,
  seedUser,
  makeSessionToken,
} from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import {
  __clearRateLimitBucketsForTests,
  rateLimit,
  LIMITS,
} from "@/lib/auth/rate-limit";
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

describe("upload-chunk — finalize quota + rate-limit isolation", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("keeps usedBytes consistent when two finalizes race near quota", async () => {
    const owner = await seedUser({
      username: "quota-racer",
      usedBytes: 0n,
      quotaBytes: 100n,
    });
    const token = await makeSessionToken(owner);
    const size = 60;
    const payload = Buffer.alloc(size, 0xab);

    const run = (uploadId: string, name: string) =>
      callRoute<{ finalized?: boolean; file?: { id: string } }>(uploadChunk, {
        method: "POST",
        url: "http://localhost:3000/api/files/upload-chunk",
        headers: chunkHeaders({
          uploadId,
          fileName: name,
          fileSize: size,
          chunkIndex: 0,
          chunkTotal: 1,
        }),
        stream: toStream(payload),
        cookies: { doma_session: token },
      });

    const [a, b] = await Promise.all([
      run("race-a", "a.bin"),
      run("race-b", "b.bin"),
    ]);

    const statuses = [a.response.status, b.response.status].sort();
    expect(statuses).toEqual([200, 413]);

    const winner =
      a.response.status === 200 ? a.data!.file!.id : b.data!.file!.id;
    const files = await db.fileNode.findMany({
      where: { ownerId: owner.id, deletedAt: null, isDirectory: false },
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe(winner);

    const user = await db.user.findUnique({ where: { id: owner.id } });
    expect(Number(user?.usedBytes)).toBe(size);
  });

  it("does not block chunks when the multipart upload bucket is exhausted", async () => {
    const owner = await seedUser({ username: "chunk-rl" });
    const token = await makeSessionToken(owner);

    for (let i = 0; i < LIMITS.upload.limit; i++) {
      const r = rateLimit(
        `upload:${owner.id}`,
        LIMITS.upload.limit,
        LIMITS.upload.windowMs
      );
      expect(r.allowed).toBe(true);
    }
    const blocked = rateLimit(
      `upload:${owner.id}`,
      LIMITS.upload.limit,
      LIMITS.upload.windowMs
    );
    expect(blocked.allowed).toBe(false);

    const payload = Buffer.from("ok-bytes");
    const { response, data } = await callRoute<{ finalized?: boolean }>(
      uploadChunk,
      {
        method: "POST",
        url: "http://localhost:3000/api/files/upload-chunk",
        headers: chunkHeaders({
          uploadId: "chunk-despite-upload-rl",
          fileName: "ok.bin",
          fileSize: payload.length,
          chunkIndex: 0,
          chunkTotal: 1,
        }),
        stream: toStream(payload),
        cookies: { doma_session: token },
      }
    );
    expect(response.status).toBe(200);
    expect(data!.finalized).toBe(true);
  });

  it("rejects a single-chunk finalize when usedBytes would exceed quota", async () => {
    const owner = await seedUser({
      username: "over",
      usedBytes: 90n,
      quotaBytes: 100n,
    });
    const token = await makeSessionToken(owner);
    const payload = Buffer.alloc(20, 1);
    const { response } = await callRoute(uploadChunk, {
      method: "POST",
      url: "http://localhost:3000/api/files/upload-chunk",
      headers: chunkHeaders({
        uploadId: "over-quota",
        fileName: "big.bin",
        fileSize: payload.length,
        chunkIndex: 0,
        chunkTotal: 1,
      }),
      stream: toStream(payload),
      cookies: { doma_session: token },
    });
    // Soft check on chunk 0 rejects before write.
    expect(response.status).toBe(413);
    expect(await db.fileNode.count({ where: { ownerId: owner.id } })).toBe(0);
    const user = await db.user.findUnique({ where: { id: owner.id } });
    expect(Number(user?.usedBytes)).toBe(90);
  });
});
