import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as zipFiles } from "@/app/api/files/zip/route";
import {
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

describe("POST /api/files/zip", () => {
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

  it("returns 401 without session", async () => {
    const { response } = await callRoute(zipFiles, {
      method: "POST",
      body: { ids: ["x"] },
    });
    expect(response.status).toBe(401);
  });

  it("rejects directories", async () => {
    const folder = await seedFile({
      ownerId: user.id,
      name: "Album",
      isDirectory: true,
    });
    const { response, data } = await callRoute<{ error: string }>(zipFiles, {
      method: "POST",
      cookies: { doma_session: token },
      body: { ids: [folder.id] },
    });
    expect(response.status).toBe(400);
    expect(data!.error).toMatch(/Папки/);
  });

  it("streams a zip for accessible files (JSON body)", async () => {
    const storage = await getStorage();
    const a = await seedFile({
      ownerId: user.id,
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 5n,
    });
    const b = await seedFile({
      ownerId: user.id,
      name: "b.txt",
      mimeType: "text/plain",
      sizeBytes: 5n,
    });
    await storage.put(a.storageKey, Buffer.from("hello"));
    await storage.put(b.storageKey, Buffer.from("world"));

    const { buildRequest } = await import("../../helpers/mock-request");
    const req = buildRequest({
      method: "POST",
      url: "http://localhost:3000/api/files/zip",
      cookies: { doma_session: token },
      body: { ids: [a.id, b.id] },
    });
    const response = await zipFiles(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const buf = Buffer.from(await response.arrayBuffer());
    expect(buf.subarray(0, 2).toString("binary")).toBe("PK");
    expect(buf.byteLength).toBeGreaterThan(40);
  });

  it("accepts form-urlencoded ids (browser download path)", async () => {
    const storage = await getStorage();
    const a = await seedFile({
      ownerId: user.id,
      name: "form.txt",
      mimeType: "text/plain",
      sizeBytes: 4n,
    });
    await storage.put(a.storageKey, Buffer.from("form"));

    const { buildRequest } = await import("../../helpers/mock-request");
    const body = new URLSearchParams({ ids: a.id });
    const req = buildRequest({
      method: "POST",
      url: "http://localhost:3000/api/files/zip",
      cookies: { doma_session: token },
      rawBody: body.toString(),
      contentType: "application/x-www-form-urlencoded",
    });
    const response = await zipFiles(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const buf = Buffer.from(await response.arrayBuffer());
    expect(buf.subarray(0, 2).toString("binary")).toBe("PK");
  });
});
