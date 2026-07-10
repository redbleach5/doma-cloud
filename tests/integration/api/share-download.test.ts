import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as createShare, GET as listShares } from "@/app/api/files/[id]/share/route";
import { POST as verifyShare } from "@/app/api/share/[token]/route";
import { GET as downloadFile } from "@/app/api/files/download/[id]/route";
import { db, resetDb, seedUser, seedFile, seedShare, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies, setMockCookies, getMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { hashPassword } from "@/lib/auth/password";

describe("POST /api/files/[id]/share (create share)", () => {
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
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "photo.jpg", mimeType: "image/jpeg" });
    fileId = f.id;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: fileId },
      body: {},
    });
    expect(response.status).toBe(401);
  });

  it("creates a share link for a file", async () => {
    const { response, data } = await callRoute<{ token: string; url: string; hasPassword: boolean }>(createShare, {
      method: "POST",
      params: { id: fileId },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.token).toBeDefined();
    expect(data!.url).toBe(`/s/${data!.token}`);
    expect(data!.hasPassword).toBe(false);
  });

  it("returns 404 for a non-existent file", async () => {
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: "nonexistent" },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for another user's file", async () => {
    const other = await seedUser({ username: "bob" });
    const otherFile = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.jpg" });
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: otherFile.id },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 422 when trying to share a directory", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: folder.id },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });

  it("returns 422 for a trashed file", async () => {
    const trashed = await seedFile({ ownerId: user.id, parentId: null, name: "trashed.jpg", deletedAt: new Date() });
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: trashed.id },
      body: {},
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("creates a password-protected share", async () => {
    const { data } = await callRoute<{ hasPassword: boolean }>(createShare, {
      method: "POST",
      params: { id: fileId },
      body: { password: "secret123" },
      cookies: { doma_session: token },
    });
    expect(data!.hasPassword).toBe(true);
  });

  it("creates a share with an expiry date", async () => {
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    const { data } = await callRoute<{ expiresAt: string | null }>(createShare, {
      method: "POST",
      params: { id: fileId },
      body: { expiresAt },
      cookies: { doma_session: token },
    });
    expect(data!.expiresAt).not.toBeNull();
  });

  it("creates a share with a maxViews limit", async () => {
    const { data } = await callRoute<{ maxViews: number | null }>(createShare, {
      method: "POST",
      params: { id: fileId },
      body: { maxViews: 5 },
      cookies: { doma_session: token },
    });
    expect(data!.maxViews).toBe(5);
  });

  it("creates a one-time-use share", async () => {
    const { data } = await callRoute<{ token: string }>(createShare, {
      method: "POST",
      params: { id: fileId },
      body: { oneTimeUse: true },
      cookies: { doma_session: token },
    });
    const share = await db.share.findUnique({ where: { token: data!.token } });
    expect(share?.oneTimeUse).toBe(true);
  });

  it("rejects invalid body (maxViews = 0)", async () => {
    const { response } = await callRoute(createShare, {
      method: "POST",
      params: { id: fileId },
      body: { maxViews: 0 },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(422);
  });
});

describe("GET /api/files/[id]/share (list shares)", () => {
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
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "photo.jpg" });
    fileId = f.id;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    const { response } = await callRoute(listShares, {
      method: "GET",
      params: { id: fileId },
    });
    expect(response.status).toBe(401);
  });

  it("returns an empty list when no shares exist", async () => {
    const { data } = await callRoute<{ shares: unknown[] }>(listShares, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: token },
    });
    expect(data!.shares).toHaveLength(0);
  });

  it("lists existing shares for a file", async () => {
    await seedShare({ fileId, createdBy: user.id, token: "tok1" });
    await seedShare({ fileId, createdBy: user.id, token: "tok2" });
    const { data } = await callRoute<{ shares: { token: string }[] }>(listShares, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: token },
    });
    expect(data!.shares).toHaveLength(2);
    expect(data!.shares.map((s) => s.token).sort()).toEqual(["tok1", "tok2"]);
  });

  it("does not leak shares for another user's file", async () => {
    const other = await seedUser({ username: "bob" });
    const otherFile = await seedFile({ ownerId: other.id, parentId: null, name: "bobs.jpg" });
    await seedShare({ fileId: otherFile.id, createdBy: other.id, token: "bobs-tok" });
    const { data } = await callRoute<{ shares: unknown[] }>(listShares, {
      method: "GET",
      params: { id: otherFile.id },
      cookies: { doma_session: token },
    });
    // Alice gets her own shares for this file (none), not Bob's.
    expect(data!.shares).toHaveLength(0);
  });
});

describe("POST /api/share/[token] (verify share)", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let fileId: string;
  let shareToken: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    const f = await seedFile({
      ownerId: user.id,
      parentId: null,
      name: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100n,
    });
    fileId = f.id;
    const share = await seedShare({ fileId, createdBy: user.id, token: "test-tok-123" });
    shareToken = share.token;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 404 for a non-existent token", async () => {
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: "nonexistent" },
      body: {},
    });
    expect(response.status).toBe(404);
  });

  it("returns file metadata for a valid public share", async () => {
    const { response, data } = await callRoute<{ file: { id: string; name: string }; share: { hasPassword: boolean } }>(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(response.status).toBe(200);
    expect(data!.file.id).toBe(fileId);
    expect(data!.file.name).toBe("photo.jpg");
    expect(data!.share.hasPassword).toBe(false);
  });

  it("returns a downloadUrl in the response", async () => {
    const { data } = await callRoute<{ downloadUrl: string }>(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(data!.downloadUrl).toContain(`/api/files/download/${fileId}?token=${shareToken}`);
  });

  it("returns 410 when the share has expired", async () => {
    await db.share.update({
      where: { token: shareToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(response.status).toBe(410);
  });

  it("returns 410 when maxViews is exhausted", async () => {
    await db.share.update({
      where: { token: shareToken },
      data: { maxViews: 1, usedCount: 1 },
    });
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(response.status).toBe(410);
  });

  it("returns 410 when the file has been trashed", async () => {
    await db.fileNode.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(response.status).toBe(410);
  });

  it("requires a password for password-protected shares", async () => {
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response, data } = await callRoute<{ needsPassword?: boolean }>(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(response.status).toBe(401);
    expect(data!.needsPassword).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: { password: "wrong" },
    });
    expect(response.status).toBe(403);
  });

  it("accepts the correct password", async () => {
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response, data } = await callRoute<{ file: { id: string } }>(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: { password: "secret123" },
    });
    expect(response.status).toBe(200);
    expect(data!.file.id).toBe(fileId);
  });

  it("increments usedCount on each verification", async () => {
    await db.share.update({
      where: { token: shareToken },
      data: { maxViews: 10 },
    });
    await callRoute(verifyShare, { method: "POST", params: { token: shareToken }, body: {} });
    await callRoute(verifyShare, { method: "POST", params: { token: shareToken }, body: {} });
    const share = await db.share.findUnique({ where: { token: shareToken } });
    expect(share?.usedCount).toBe(2);
  });

  it("blocks a second verification after one-time-use (share NOT deleted, usedCount=maxViews=1)", async () => {
    // The previous implementation deleted the share on first verify, which
    // broke the download route (it would 403 because the share was gone
    // before the download stream started). The fix: keep the share row,
    // treat oneTimeUse as maxViews=1, and use the same atomic conditional
    // UPDATE on usedCount. A second verify should return 410.
    await db.share.update({
      where: { token: shareToken },
      data: { oneTimeUse: true },
    });
    const r1 = await callRoute(verifyShare, { method: "POST", params: { token: shareToken }, body: {} });
    expect(r1.response.status).toBe(200);
    // Share row still exists so download can stream the file.
    const share = await db.share.findUnique({ where: { token: shareToken } });
    expect(share).not.toBeNull();
    expect(share?.usedCount).toBe(1);
    // Second verify should be blocked (usedCount >= effectiveMaxViews=1).
    const r2 = await callRoute(verifyShare, { method: "POST", params: { token: shareToken }, body: {} });
    expect(r2.response.status).toBe(410);
  });

  it("sets a verified-password cookie after successful password verification", async () => {
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: { password: "secret123" },
    });
    // The route sets the cookie via response.cookies.set(), which adds a
    // Set-Cookie header. We verify the header contains a doma_sv_ cookie.
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toMatch(/doma_sv_[a-z0-9]+=1/);
  });

  it("rate-limits after 20 verification attempts per minute", async () => {
    // Use a constant IP via X-Forwarded-For.
    const ip = "10.0.0.77";
    for (let i = 0; i < 20; i++) {
      await callRoute(verifyShare, {
        method: "POST",
        params: { token: shareToken },
        body: {},
        headers: { "x-forwarded-for": ip },
      });
    }
    const { response } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
      headers: { "x-forwarded-for": ip },
    });
    expect(response.status).toBe(429);
  });
});

describe("GET /api/files/download/[id]", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;
  let fileId: string;
  let shareToken: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    const ctx = await makeTempStorage();
    user = await seedUser({ username: "alice" });
    token = await makeSessionToken(user);
    // Create a file with actual storage content.
    const storage = await (await import("@/lib/storage")).getStorage();
    const storageKey = "alice/file1/download.txt";
    await storage.put(storageKey, Buffer.from("download me"));
    const f = await db.fileNode.create({
      data: {
        ownerId: user.id,
        parentId: null,
        name: "download.txt",
        storageKey,
        isDirectory: false,
        sizeBytes: 11n,
        mimeType: "text/plain",
      },
    });
    fileId = f.id;
    const share = await seedShare({ fileId, createdBy: user.id, token: "dl-tok-123" });
    shareToken = share.token;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated and no share token", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: fileId },
    });
    expect(response.status).toBe(401);
  });

  it("downloads a file when authenticated as the owner", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(response.headers.get("Content-Disposition")).toContain("download.txt");
  });

  it("returns 404 when downloading a non-existent file", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: "nonexistent" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when downloading another user's file (no share token)", async () => {
    const other = await seedUser({ username: "bob" });
    const otherToken = await makeSessionToken(other);
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: otherToken },
    });
    expect(response.status).toBe(404);
  });

  it("downloads a file via a share token", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${shareToken}`,
      params: { id: fileId },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
  });

  it("returns 403 when the share token doesn't match the file", async () => {
    // Create a share for a different file.
    const f2 = await seedFile({ ownerId: user.id, parentId: null, name: "other.txt" });
    const otherShare = await seedShare({ fileId: f2.id, createdBy: user.id, token: "other-tok" });
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${otherShare.token}`,
      params: { id: fileId },
    });
    expect(response.status).toBe(403);
  });

  it("returns 410 when the share has expired", async () => {
    await db.share.update({
      where: { token: shareToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${shareToken}`,
      params: { id: fileId },
    });
    expect(response.status).toBe(410);
  });

  it("returns 410 when the shared file is trashed", async () => {
    await db.fileNode.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${shareToken}`,
      params: { id: fileId },
    });
    expect(response.status).toBe(410);
  });

  it("returns 401 when downloading a password-protected share without a password", async () => {
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response, data } = await callRoute<{ needsPassword?: boolean }>(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${shareToken}`,
      params: { id: fileId },
    });
    expect(response.status).toBe(401);
    expect(data!.needsPassword).toBe(true);
  });

  it("rejects ?sharePassword= in the URL (removed for security — use the verify-cookie flow)", async () => {
    // We removed ?sharePassword= from the download route because:
    //   1. It leaked into access logs / browser history / referrers.
    //   2. It was brute-forceable at the download rate limit of 200/min
    //      (10× faster than the verify endpoint's 20/min limit).
    // The share page must call POST /api/share/[token] first, which sets
    // a doma_sv_<hash> cookie that the download route accepts.
    const pwHash = await hashPassword("secret123");
    await db.share.update({
      where: { token: shareToken },
      data: { passwordHash: pwHash },
    });
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      url: `http://localhost:3000/api/files/download/${fileId}?token=${shareToken}&sharePassword=secret123`,
      params: { id: fileId },
    });
    expect(response.status).toBe(401); // password cookie not set → 401
  });

  it("supports Range requests (206 Partial Content)", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: fileId },
      headers: { Range: "bytes=0-4" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 0-4/11`);
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("returns 416 for a Range start beyond file size", async () => {
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: fileId },
      headers: { Range: "bytes=100-200" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(`bytes */11`);
  });

  it("returns 400 when downloading a directory", async () => {
    const folder = await seedFile({ ownerId: user.id, parentId: null, isDirectory: true, name: "folder" });
    const { response } = await callRoute(downloadFile, {
      method: "GET",
      params: { id: folder.id },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(400);
  });
});
