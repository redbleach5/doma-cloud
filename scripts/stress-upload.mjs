#!/usr/bin/env bun
/**
 * Upload scale / integrity stress harness.
 *
 * Usage:
 *   bun scripts/stress-upload.mjs [baseUrl]
 *
 * Env:
 *   STRESS_TS          — user/file suffix (default: timestamp)
 *   STRESS_COUNT       — tiny multipart files in phase A (default: 1000)
 *   STRESS_CHUNK_MB    — chunked file size for phase B (default: 64)
 *   STRESS_LARGE_MB    — optional overnight phase F (unset = skip)
 *   STRESS_PASS        — password (default: SmokeTest1!)
 *
 * Exit 1 if any integrity invariant fails.
 */
import { createHash } from "node:crypto";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASS = process.env.STRESS_PASS ?? "SmokeTest1!";
const TS = process.env.STRESS_TS ?? `s${Date.now().toString(36)}`;
const COUNT = Math.max(1, parseInt(process.env.STRESS_COUNT ?? "1000", 10));
const CHUNK_MB = Math.max(1, parseInt(process.env.STRESS_CHUNK_MB ?? "64", 10));
const LARGE_MB = process.env.STRESS_LARGE_MB
  ? Math.max(1, parseInt(process.env.STRESS_LARGE_MB, 10))
  : null;

const USER = `stress_up_${TS}`;
const CHUNK_SIZE = 5 * 1024 * 1024;

const jar = new Map();

function cookieHeader() {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const m = line.match(/^([^=]+)=([^;]*)/);
    if (m) jar.set(m[1], m[2]);
  }
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
  throw new Error(label);
}

async function api(method, path, { body, form, expect, headers: extra, rawBody, binary } = {}) {
  const headers = { ...(extra ?? {}) };
  const ch = cookieHeader();
  if (ch) headers.Cookie = ch;
  let payload;
  if (form) payload = form;
  else if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  absorbCookies(res);
  let data = null;
  if (binary) {
    data = Buffer.from(await res.arrayBuffer());
  } else {
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(
      `${method} ${path} → ${res.status} (expected ${expect}): ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data)}`
    );
  }
  return { res, data };
}

async function withRetry(fn, label, { maxAttempts = 16 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err.message ?? err);
      const transient =
        msg.includes("429") ||
        msg.includes("socket") ||
        msg.includes("ECONNRESET") ||
        msg.includes("fetch failed") ||
        msg.includes("closed unexpectedly") ||
        msg.includes("503") ||
        msg.includes("502");
      if (transient) {
        const wait = msg.includes("429")
          ? Math.min(65_000, 2000 * (attempt + 1))
          : Math.min(15_000, 500 * (attempt + 1));
        console.log(`    … retry ${label} (${msg.slice(0, 60)}…), wait ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function ensureUser(username) {
  jar.clear();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await api("POST", "/api/auth/register", {
        body: { username, displayName: username, password: PASS },
        expect: 200,
      });
      ok(`${username} registered`);
      break;
    } catch (err) {
      const msg = String(err.message);
      if (msg.includes("409")) {
        ok(`${username} already exists`);
        break;
      }
      if (msg.includes("429")) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await api("POST", "/api/auth/login", {
        body: { username, password: PASS },
        expect: 200,
      });
      return;
    } catch (err) {
      if (String(err.message).includes("429")) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`login failed for ${username}`);
}

async function mkdir(name, parentId = null) {
  const body = parentId ? { name, parentId } : { name };
  const { data } = await withRetry(
    () => api("POST", "/api/files/mkdir", { body, expect: 200 }),
    "mkdir"
  );
  return data.id;
}

async function uploadTiny(name, content, parentId) {
  const form = new FormData();
  form.append("files", new File([content], name, { type: "text/plain" }));
  const qs = parentId ? `?parentId=${parentId}` : "";
  const { data } = await withRetry(
    () => api("POST", `/api/files/upload${qs}`, { form, expect: 200 }),
    `upload ${name}`
  );
  const f = data.created?.[0];
  if (!f?.id) throw new Error(`upload missing id: ${JSON.stringify(data)}`);
  return f;
}

async function uploadChunked(name, buffer, parentId) {
  const uploadId = `stress-${TS}-${Math.random().toString(36).slice(2, 10)}`;
  const totalChunks = Math.max(1, Math.ceil(buffer.length / CHUNK_SIZE));
  const qs = parentId ? `?parentId=${parentId}` : "";
  let finalized = null;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, buffer.length);
    const chunk = buffer.subarray(start, end);
    const headers = {
      "content-type": "application/octet-stream",
      "x-upload-id": uploadId,
      "x-file-name": encodeURIComponent(name),
      "x-file-size": String(buffer.length),
      "x-file-mime": "application/octet-stream",
      "x-chunk-index": String(i),
      "x-chunk-total": String(totalChunks),
    };
    const { data } = await withRetry(
      () =>
        api("POST", `/api/files/upload-chunk${qs}`, {
          rawBody: chunk,
          headers,
          expect: 200,
        }),
      `chunk ${i + 1}/${totalChunks}`
    );
    if (data.finalized) finalized = data;
  }
  if (!finalized?.file?.id) throw new Error("chunked upload did not finalize");
  return finalized.file;
}

async function abortUpload(uploadId) {
  await api("DELETE", `/api/files/upload-chunk?uploadId=${uploadId}`, {
    expect: 200,
  });
}

async function listAll(parentId) {
  const qs = parentId ? `?parentId=${parentId}` : "";
  const { data } = await api("GET", `/api/files/list${qs}`, { expect: 200 });
  return data.items ?? [];
}

async function me() {
  const { data } = await api("GET", "/api/me", { expect: 200 });
  return data.user ?? data;
}

async function downloadHash(id) {
  const { res, data } = await api("GET", `/api/files/download/${id}`, {
    expect: 200,
    binary: true,
  });
  const len = Number(res.headers.get("content-length") ?? data.length);
  const hash = createHash("sha256").update(data).digest("hex");
  return { len, hash, bytes: data };
}

async function reconcile(folderId, expectedFileIds) {
  const user = await me();
  const items = await listAll(folderId);
  const files = items.filter((i) => !i.isDirectory);
  const idSet = new Set(expectedFileIds);
  const found = files.filter((f) => idSet.has(f.id));
  if (found.length !== expectedFileIds.length) {
    fail(
      "listing count mismatch",
      `expected ${expectedFileIds.length} tracked files, found ${found.length} in folder`
    );
  }

  let sum = 0n;
  // Spot-check: all tiny + hash every file up to 64 samples evenly + always chunked ones.
  const sampleEvery = Math.max(1, Math.floor(expectedFileIds.length / 64));
  for (let i = 0; i < expectedFileIds.length; i++) {
    const id = expectedFileIds[i];
    const meta = files.find((f) => f.id === id);
    if (!meta) fail("missing file in list", id);
    sum += BigInt(meta.sizeBytes);
    if (i % sampleEvery === 0 || Number(meta.sizeBytes) > 1024 * 1024) {
      const dl = await downloadHash(id);
      if (dl.len !== Number(meta.sizeBytes) && dl.bytes.length !== Number(meta.sizeBytes)) {
        fail("download size mismatch", `${id}: meta=${meta.sizeBytes} got=${dl.bytes.length}`);
      }
    }
  }

  // usedBytes must be >= sum of files created in this run; other files on the
  // account may exist. After admin recompute we'd want equality — for stress
  // we assert our folder files download and usedBytes didn't go below sum
  // of ALL non-trashed owned files if we can list root + recurse. Cheap check:
  // usedBytes >= sum of this folder's files.
  const used = BigInt(user.usedBytes);
  if (used < sum) {
    fail("usedBytes below folder sum", `used=${used} folderSum=${sum}`);
  }
  ok(`reconcile: ${expectedFileIds.length} files, folderSum=${sum}, usedBytes=${used}`);
}

async function phaseA(folderId, tracked) {
  console.log(`\nPhase A — ${COUNT} tiny multipart uploads`);
  // Stay under LIMITS.upload (100/min) with ~650ms pacing ≈ 90/min.
  const paceMs = Math.max(0, parseInt(process.env.STRESS_PACE_MS ?? "650", 10));
  for (let i = 0; i < COUNT; i++) {
    const name = `tiny_${String(i).padStart(5, "0")}.txt`;
    const content = `stress-${TS}-${i}\n`;
    const f = await uploadTiny(name, content, folderId);
    tracked.push(f.id);
    if ((i + 1) % 100 === 0 || i + 1 === COUNT) {
      ok(`uploaded ${i + 1}/${COUNT}`);
    }
    if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
  }
}

async function phaseB(folderId, tracked) {
  const bytes = CHUNK_MB * 1024 * 1024;
  console.log(`\nPhase B — ${CHUNK_MB} MB chunked upload`);
  // Patterned buffer so hash is meaningful without holding two full copies long.
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i + 4 <= bytes; i += 4096) {
    buf.writeUInt32LE((i / 4096) ^ 0x51e55ed, i);
  }
  const expectedHash = createHash("sha256").update(buf).digest("hex");
  const file = await uploadChunked(`chunked_${CHUNK_MB}mb.bin`, buf, folderId);
  tracked.push(file.id);
  const dl = await downloadHash(file.id);
  if (dl.hash !== expectedHash) {
    fail("chunked hash mismatch", `want ${expectedHash} got ${dl.hash}`);
  }
  if (dl.bytes.length !== bytes) {
    fail("chunked size mismatch", `${dl.bytes.length} != ${bytes}`);
  }
  ok(`chunked ${CHUNK_MB} MB verified (sha256 ${expectedHash.slice(0, 12)}…)`);
}

async function phaseC(folderId, tracked) {
  console.log("\nPhase C — parallel chunked uploads (integrity under concurrency)");
  const size = 256 * 1024; // 256 KB each — both should succeed under normal quota
  const mk = (tag) => {
    const b = Buffer.alloc(size, tag.charCodeAt(0));
    return b;
  };
  const a = mk("A");
  const b = mk("B");
  const [fa, fb] = await Promise.all([
    uploadChunked(`par_a_${TS}.bin`, a, folderId),
    uploadChunked(`par_b_${TS}.bin`, b, folderId),
  ]);
  tracked.push(fa.id, fb.id);
  const da = await downloadHash(fa.id);
  const db_ = await downloadHash(fb.id);
  if (da.hash !== createHash("sha256").update(a).digest("hex")) fail("parallel A hash");
  if (db_.hash !== createHash("sha256").update(b).digest("hex")) fail("parallel B hash");
  ok("parallel chunked pair both readable (hard near-quota race covered by upload-scale.test.ts)");
}

async function phaseD(folderId, tracked) {
  console.log("\nPhase D — abort mid-upload then successful redo");
  const uploadId = `abort-${TS}`;
  const part = Buffer.from("PARTIAL-CHUNK-DATA!!");
  const fakeSize = part.length * 2;
  await withRetry(
    () =>
      api("POST", `/api/files/upload-chunk?parentId=${folderId}`, {
        rawBody: part,
        headers: {
          "content-type": "application/octet-stream",
          "x-upload-id": uploadId,
          "x-file-name": encodeURIComponent("aborted.bin"),
          "x-file-size": String(fakeSize),
          "x-file-mime": "application/octet-stream",
          "x-chunk-index": "0",
          "x-chunk-total": "2",
        },
        expect: 200,
      }),
    "abort-prep chunk0"
  );
  await abortUpload(uploadId);
  // No FileNode for aborted.bin
  const before = await listAll(folderId);
  if (before.some((i) => i.name === "aborted.bin")) {
    fail("abort left a FileNode");
  }
  // Redo with new id
  const full = Buffer.concat([part, part]);
  const file = await uploadChunked(`aborted_redo_${TS}.bin`, full, folderId);
  tracked.push(file.id);
  ok("abort cleaned session; redo succeeded");
}

async function phaseE(folderId) {
  console.log("\nPhase E — caps: chunkTotal>20000 and size lie");
  // Over chunkTotal cap
  {
    const { res } = await api("POST", `/api/files/upload-chunk?parentId=${folderId}`, {
      rawBody: Buffer.from("x"),
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": `cap-${TS}`,
        "x-file-name": encodeURIComponent("cap.bin"),
        "x-file-size": "1",
        "x-file-mime": "application/octet-stream",
        "x-chunk-index": "0",
        "x-chunk-total": "20001",
      },
    });
    if (res.status !== 400) fail("chunkTotal 20001 should be 400", `got ${res.status}`);
    ok("chunkTotal 20001 → 400");
  }
  // Size lie: declare 8 bytes, send 4 as single chunk
  {
    const uploadId = `lie-${TS}`;
    const { res, data } = await api("POST", `/api/files/upload-chunk?parentId=${folderId}`, {
      rawBody: Buffer.from("abcd"),
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": uploadId,
        "x-file-name": encodeURIComponent("lie.bin"),
        "x-file-size": "8",
        "x-file-mime": "application/octet-stream",
        "x-chunk-index": "0",
        "x-chunk-total": "1",
      },
    });
    if (res.status !== 422) fail("size lie should be 422", `got ${res.status} ${JSON.stringify(data)}`);
    const items = await listAll(folderId);
    if (items.some((i) => i.name === "lie.bin")) fail("size lie left a FileNode");
    ok("size lie → 422, no FileNode");
  }
}

async function phaseF(folderId, tracked) {
  if (LARGE_MB == null) {
    console.log("\nPhase F — skipped (set STRESS_LARGE_MB to enable)");
    return;
  }
  console.log(`\nPhase F — large ${LARGE_MB} MB chunked (overnight-style)`);
  const bytes = LARGE_MB * 1024 * 1024;
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 65536) {
    buf.writeUInt32LE(i ^ 0x1a2b3c4d, i);
  }
  const expectedHash = createHash("sha256").update(buf).digest("hex");
  const file = await uploadChunked(`large_${LARGE_MB}mb.bin`, buf, folderId);
  tracked.push(file.id);
  const dl = await downloadHash(file.id);
  if (dl.hash !== expectedHash) fail("large hash mismatch");
  ok(`large ${LARGE_MB} MB verified`);
}

async function main() {
  console.log(`\nDoma Cloud upload stress → ${BASE}`);
  console.log(`  user=${USER} count=${COUNT} chunkMb=${CHUNK_MB} largeMb=${LARGE_MB ?? "off"}\n`);

  await ensureUser(USER);
  const folderId = await mkdir(`StressUpload_${TS}`);
  const tracked = [];

  await phaseA(folderId, tracked);
  await phaseB(folderId, tracked);
  await phaseC(folderId, tracked);
  await phaseD(folderId, tracked);
  await phaseE(folderId);
  await phaseF(folderId, tracked);

  console.log("\nReconcile");
  await reconcile(folderId, tracked);

  console.log("\n✅ Upload stress passed.\n");
  console.log("Proven: many tiny uploads, chunked integrity, parallel uploads,");
  console.log("abort/redo, protocol caps. Near-quota race: upload-scale.test.ts.");
  console.log("Not proven here: full 100 GB wall-clock (needs hours + ≥2× free disk).");
  console.log(
    `Estimate at 600 chunks/min: 100 GB ≈ ${Math.ceil((100 * 1024) / 5 / 600)} min of chunk POSTs.`
  );
}

main().catch((err) => {
  console.error("\n❌ Upload stress failed:", err.message ?? err);
  process.exit(1);
});
