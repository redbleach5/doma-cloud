/**
 * Video poster end-to-end (ffmpeg-based). The thumbnail route now accepts
 * video/*, probes codec/duration via ffprobe, persists them in the DB,
 * extracts a poster frame via ffmpeg and serves a JPEG. Falls back to the
 * FileIcon in the UI when ffmpeg is absent, so this test skips gracefully
 * when the binaries aren't found.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GET as thumbnailRoute } from "@/app/api/files/thumbnail/[id]/route";
import { db, resetDb, seedUser, makeSessionToken } from "../../helpers/db";
import { resetMockCookies } from "../../helpers/mock-cookies";
import { makeTempStorage, cleanupTempStorage } from "../../helpers/storage";
import { locateFfmpeg } from "@/lib/media/ffmpeg";
import { __clearRateLimitBucketsForTests } from "@/lib/auth/rate-limit";

let storageRoot: string;
let user: Awaited<ReturnType<typeof seedUser>>;
let token: string;

describe("GET /api/files/thumbnail — video poster (ffmpeg)", () => {
  beforeEach(async () => {
    await resetDb();
    resetMockCookies();
    __clearRateLimitBucketsForTests();
    const temp = await makeTempStorage();
    storageRoot = temp.root;
    user = await seedUser({});
    token = await makeSessionToken(user);
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  it("generates a poster frame and fills video metadata", async () => {
    const bins = await locateFfmpeg();
    if (!bins) {
      console.warn("ffmpeg not available — skipping video poster test");
      return;
    }

    const key = `${user.id}/vid1/poster.mp4`;
    const vidPath = path.join(storageRoot, key);
    await fs.mkdir(path.dirname(vidPath), { recursive: true });

    // Deterministic 1-second H.264 test clip, 64x64.

    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      bins.ffmpeg,
      ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10", "-pix_fmt", "yuv420p", "-f", "mp4", vidPath],
      { encoding: "utf-8" }
    );
    if (r.status !== 0) {
      throw new Error(`ffmpeg fixture failed: ${(r.stderr ?? "").slice(0, 200)}`);
    }

    const file = await db.fileNode.create({
      data: {
        ownerId: user.id,
        name: "poster.mp4",
        storageKey: key,
        isDirectory: false,
        sizeBytes: BigInt((await fs.stat(vidPath)).size),
        mimeType: "video/mp4",
      },
    });

    // Binary JPEG body — callRoute consumes the body via .json(), so invoke
    // the handler directly (same pattern as the SVG rasterization test).
    const { buildRequest } = await import("../../helpers/mock-request");
    const req = buildRequest({
      method: "GET",
      url: `http://localhost:3000/api/files/thumbnail/${file.id}?size=64`,
      cookies: { doma_session: token },
    });
    const response = await thumbnailRoute(req, { params: Promise.resolve({ id: file.id }) });
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    // A real JPEG poster — not an error JSON payload. JPEG SOI marker.
    expect(body.length).toBeGreaterThan(500);
    expect(body[0]).toBe(0xff);
    expect(body[1]).toBe(0xd8);

    // Metadata branch persists ffprobe output (testsrc → h264, 64x64).
    const after = await db.fileNode.findUnique({ where: { id: file.id } });
    expect(after?.videoCodec).toBe("h264");
    expect(after?.videoWidth).toBe(64);
    expect(after?.videoHeight).toBe(64);
    expect(after?.durationMs).toBeGreaterThanOrEqual(900);
  });
});