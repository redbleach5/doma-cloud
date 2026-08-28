import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { POST as createShare, GET as listShares } from "@/app/api/files/[id]/share/route";
import { DELETE as revokeShare } from "@/app/api/files/[id]/share/[token]/route";
import { POST as verifyShare } from "@/app/api/share/[token]/route";
import { db, resetDb, seedUser, seedFile, seedShare, makeSessionToken } from "../../helpers/db";
import { callRoute } from "../../helpers/mock-request";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";

describe("DELETE /api/files/[id]/share/[token] (revoke share)", () => {
  let user: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let other: { id: string; username: string; role: "admin" | "user"; tokenVersion: number };
  let token: string;
  let otherToken: string;
  let fileId: string;
  let shareToken: string;

  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    await makeTempStorage();
    user = await seedUser({ username: "alice" });
    other = await seedUser({ username: "bob" });
    token = await makeSessionToken(user);
    otherToken = await makeSessionToken(other);
    const f = await seedFile({ ownerId: user.id, parentId: null, name: "photo.jpg", mimeType: "image/jpeg" });
    fileId = f.id;
    // Create the share directly via the DB helper (avoids polluting the
    // mock cookie store with `token`, which would make the "unauthenticated"
    // test below see a stale session cookie).
    const share = await seedShare({ nodeId: fileId, createdBy: user.id });
    shareToken = share.token;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("returns 401 when not authenticated", async () => {
    // Re-clear cookies in case any prior callRoute in this test polluted
    // the mock cookie store.
    resetMockCookies();
    const { response } = await callRoute(revokeShare, {
      method: "DELETE",
      params: { id: fileId, token: shareToken },
    });
    expect(response.status).toBe(401);
  });

  it("revokes the share when the owner calls it", async () => {
    const { response, data } = await callRoute<{ ok: boolean }>(revokeShare, {
      method: "DELETE",
      params: { id: fileId, token: shareToken },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(200);
    expect(data!.ok).toBe(true);

    // Share is gone from the DB.
    const share = await db.share.findUnique({ where: { token: shareToken } });
    expect(share).toBeNull();

    // Verify now 404s.
    const { response: verify } = await callRoute(verifyShare, {
      method: "POST",
      params: { token: shareToken },
      body: {},
    });
    expect(verify.status).toBe(404);
  });

  it("returns 404 when revoking a share on another user's file", async () => {
    const { response } = await callRoute(revokeShare, {
      method: "DELETE",
      params: { id: fileId, token: shareToken },
      cookies: { doma_session: otherToken },
    });
    expect(response.status).toBe(404);

    // Share still exists.
    const share = await db.share.findUnique({ where: { token: shareToken } });
    expect(share).not.toBeNull();
  });

  it("returns 404 for a non-existent token", async () => {
    const { response } = await callRoute(revokeShare, {
      method: "DELETE",
      params: { id: fileId, token: "nonexistent-token-xyz" },
      cookies: { doma_session: token },
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when the file id does not belong to the caller", async () => {
    // Bob creates their own file, then tries to revoke alice's share
    // using bob's file id (mismatched file/token pair).
    const bobFile = await seedFile({ ownerId: other.id, parentId: null, name: "bob.jpg" });
    const { response } = await callRoute(revokeShare, {
      method: "DELETE",
      params: { id: bobFile.id, token: shareToken },
      cookies: { doma_session: otherToken },
    });
    expect(response.status).toBe(404);
  });

  it("is reflected in GET /api/files/[id]/share after revocation", async () => {
    // Before: one share.
    const { data: before } = await callRoute<{ shares: Array<{ token: string }> }>(listShares, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: token },
    });
    expect(before!.shares).toHaveLength(1);

    // Revoke.
    await callRoute(revokeShare, {
      method: "DELETE",
      params: { id: fileId, token: shareToken },
      cookies: { doma_session: token },
    });

    // After: zero shares.
    const { data: after } = await callRoute<{ shares: Array<{ token: string }> }>(listShares, {
      method: "GET",
      params: { id: fileId },
      cookies: { doma_session: token },
    });
    expect(after!.shares).toHaveLength(0);
  });
});
