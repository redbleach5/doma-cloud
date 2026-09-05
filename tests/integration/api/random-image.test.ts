/**
 * GET /api/files/random-image — pick a memory from the owner's library.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GET as randomImage } from "@/app/api/files/random-image/route";
import { resetDb, seedUser, seedFile, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import type { FileItem } from "@/lib/cloud/api";

describe("GET /api/files/random-image", () => {
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
    const { response } = await callRoute(randomImage, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("returns item: null when the library has no images", async () => {
    await seedFile({
      ownerId: user.id,
      name: "note.txt",
      mimeType: "text/plain",
    });
    const { response, data } = await callRoute<{ item: FileItem | null }>(randomImage, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.item).toBeNull();
  });

  it("returns one of the owner's images and skips trash", async () => {
    const keep = await seedFile({
      ownerId: user.id,
      name: "keep.jpg",
      mimeType: "image/jpeg",
    });
    await seedFile({
      ownerId: user.id,
      name: "gone.jpg",
      mimeType: "image/jpeg",
      deletedAt: new Date(),
    });
    await seedFile({
      ownerId: user.id,
      name: "doc.pdf",
      mimeType: "application/pdf",
    });

    const { response, data } = await callRoute<{ item: FileItem }>(randomImage, {
      method: "GET",
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.item.id).toBe(keep.id);
    expect(data!.item.category).toBe("image");
  });

  it("prefers images older than 30 days when available", async () => {
    const old = await seedFile({
      ownerId: user.id,
      name: "old.jpg",
      mimeType: "image/jpeg",
    });
    // createdAt is set by seed defaults — force both ages via update.
    const { db } = await import("../../helpers/db");
    await db.fileNode.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });
    const recent = await seedFile({
      ownerId: user.id,
      name: "recent.jpg",
      mimeType: "image/jpeg",
    });

    // With an old photo present, random should never land on the recent one
    // across many draws (pool is size 1).
    for (let i = 0; i < 8; i++) {
      const { data } = await callRoute<{ item: FileItem }>(randomImage, {
        method: "GET",
        cookies: { doma_session: token },
      });
      expect(data!.item.id).toBe(old.id);
      expect(data!.item.id).not.toBe(recent.id);
    }
  });
});
