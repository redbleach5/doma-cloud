#!/usr/bin/env bun
/**
 * Live smoke test against a running dev server.
 * Usage: bun scripts/smoke-e2e.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
const PASS = "SmokeTest1!";
const TS = process.env.SMOKE_TS ?? "live1";
const USERS = {
  owner: `smoke_owner_${TS}`,
  guest: `smoke_guest_${TS}`,
  stranger: `smoke_stranger_${TS}`,
};

const jar = new Map();
let currentUser = null;

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

async function api(method, path, { body, form, expect } = {}) {
  const headers = {};
  const ch = cookieHeader();
  if (ch) headers.Cookie = ch;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  absorbCookies(res);
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const ok = expect ? res.status === expect : res.ok;
  if (!ok) {
    throw new Error(
      `${method} ${path} → ${res.status} (expected ${expect ?? "2xx"}): ${JSON.stringify(data)}`
    );
  }
  return { res, data };
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}

async function ensureUser(username) {
  jar.clear();
  currentUser = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await api("POST", "/api/auth/register", {
        body: { username, displayName: username, password: PASS },
        expect: 200,
      });
      ok(`${username} — registered`);
      await new Promise((r) => setTimeout(r, 300));
      return;
    } catch (err) {
      const msg = String(err.message);
      if (msg.includes("409")) {
        ok(`${username} — already exists`);
        await new Promise((r) => setTimeout(r, 300));
        return;
      }
      // Do NOT treat 429 as "already exists" — user was never created.
      if (msg.includes("429")) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`register ${username} failed after rate-limit retries`);
}

async function login(username) {
  jar.clear();
  currentUser = null;
  await api("POST", "/api/auth/login", {
    body: { username, password: PASS },
    expect: 200,
  });
  currentUser = username;
}

async function actAs(username) {
  if (currentUser === username && jar.size > 0) return;
  await login(username);
}

async function main() {
  console.log(`\nDoma Cloud smoke test → ${BASE}\n`);

  // --- 1. Ensure 3 users exist ---
  for (const u of Object.values(USERS)) {
    await ensureUser(u);
  }

  // --- 2. Owner: folder + upload + list ---
  await actAs(USERS.owner);
  const me = await api("GET", "/api/me", { expect: 200 });
  ok(`owner logged in (${me.data.user?.username ?? me.data.username})`);

  const folderName = `SmokePhotos_${TS}`;
  let folderId;
  const rootList = await api("GET", "/api/files/list", { expect: 200 });
  const found = rootList.data.items?.find(
    (i) => i.isDirectory && i.name === folderName
  );
  if (found) {
    folderId = found.id;
    ok(`reusing folder ${folderName}`);
  } else {
    const folder = await api("POST", "/api/files/mkdir", {
      body: { name: folderName },
      expect: 200,
    });
    folderId = folder.data.id;
    ok(`created folder ${folder.data.name}`);
  }

  const uploadName = `hello_${TS}.txt`;
  const folderList = await api("GET", `/api/files/list?parentId=${folderId}`, {
    expect: 200,
  });
  let uploadedId = folderList.data.items?.find((i) => i.name === uploadName)?.id;
  if (!uploadedId) {
    const form = new FormData();
    form.append(
      "files",
      new File(["Hello from smoke test"], uploadName, { type: "text/plain" })
    );
    const upload = await api(
      "POST",
      `/api/files/upload?parentId=${folderId}`,
      { form, expect: 200 }
    );
    const uploaded = upload.data.created?.[0];
    if (!uploaded?.id) throw new Error(`upload missing file id: ${JSON.stringify(upload.data)}`);
    uploadedId = uploaded.id;
    ok(`uploaded ${uploadName} (${uploadedId})`);
  } else {
    ok(`reusing uploaded file ${uploadName}`);
  }
  const uploaded = { id: uploadedId, name: uploadName };

  const list = await api("GET", `/api/files/list?parentId=${folderId}`, {
    expect: 200,
  });
  if (!list.data.items?.some((i) => i.name === uploadName)) {
    throw new Error("uploaded file not in folder listing");
  }
  ok("file appears in folder listing");

  // --- 3b. Share a FILE with guest (user ACL → «Общие») ---
  const fileShareName = `memo_${TS}.txt`;
  let fileShareId = rootList.data.items?.find(
    (i) => !i.isDirectory && i.name === fileShareName
  )?.id;
  if (!fileShareId) {
    const form = new FormData();
    form.append(
      "files",
      new File(["family memo"], fileShareName, { type: "text/plain" })
    );
    const up = await api("POST", "/api/files/upload", { form, expect: 200 });
    fileShareId = up.data.created?.[0]?.id;
    if (!fileShareId) throw new Error("file share upload failed");
    ok(`uploaded root file ${fileShareName}`);
  } else {
    ok(`reusing root file ${fileShareName}`);
  }

  await api("POST", `/api/files/${fileShareId}/share-folder`, {
    body: { recipientUsername: USERS.guest, permission: "view" },
    expect: 200,
  });
  ok(`shared file with ${USERS.guest}`);

  // --- 3. Share folder with guest (idempotent) ---
  await api("POST", `/api/files/${folderId}/share-folder`, {
    body: { recipientUsername: USERS.guest, permission: "edit" },
    expect: 200,
  });
  ok(`shared folder with ${USERS.guest}`);

  // --- 4. Guest: shared-with-me + browse + upload ---
  await actAs(USERS.guest);
  const shared = await api("GET", "/api/shares/shared-with-me", { expect: 200 });
  const shareRow = shared.data.items?.find((i) => i.folderName === folderName);
  if (!shareRow) throw new Error("guest does not see shared folder");
  ok("guest sees folder in shared-with-me");

  const fileShareRow = shared.data.items?.find(
    (i) => i.folderName === fileShareName || i.nodeName === fileShareName
  );
  if (!fileShareRow) throw new Error("guest does not see shared file in Общие");
  if (fileShareRow.isDirectory === true) {
    throw new Error("shared file listed as directory");
  }
  ok("guest sees shared file in shared-with-me");

  const guestDl = await fetch(`${BASE}/api/files/download/${fileShareId}`, {
    headers: { Cookie: cookieHeader() ?? "" },
  });
  if (!guestDl.ok) {
    throw new Error(`guest download of shared file failed: ${guestDl.status}`);
  }
  const guestContent = await guestDl.text();
  if (!guestContent.includes("family memo")) {
    throw new Error("guest downloaded wrong content for shared file");
  }
  ok("guest can download shared file");

  const strangerFile = await (async () => {
    await actAs(USERS.stranger);
    return fetch(`${BASE}/api/files/download/${fileShareId}`, {
      headers: { Cookie: cookieHeader() ?? "" },
    });
  })();
  if (strangerFile.status !== 404 && strangerFile.status !== 403) {
    throw new Error(
      `stranger download expected 403/404, got ${strangerFile.status}`
    );
  }
  ok("stranger cannot download ACL-shared file");

  await actAs(USERS.guest);
  const guestList = await api(
    "GET",
    `/api/files/list?sharedFolderId=${shareRow.id}`,
    { expect: 200 }
  );
  if (!guestList.data.items?.some((i) => i.name === uploadName)) {
    throw new Error("guest cannot see shared file");
  }
  ok("guest can browse shared folder");

  const guestUploadName = `guest-note_${TS}.txt`;
  if (!guestList.data.items?.some((i) => i.name === guestUploadName)) {
    const guestForm = new FormData();
    guestForm.append(
      "files",
      new File(["from guest"], guestUploadName, { type: "text/plain" })
    );
    await api(
      "POST",
      `/api/files/upload?sharedFolderId=${shareRow.id}&parentId=${folderId}`,
      { form: guestForm, expect: 200 }
    );
    ok("guest uploaded to shared folder");
  } else {
    ok("guest upload already present");
  }

  // --- 5. Stranger denied ---
  await actAs(USERS.stranger);
  const denied = await fetch(
    `${BASE}/api/files/list?sharedFolderId=${shareRow.id}`,
    { headers: { Cookie: cookieHeader() ?? "" } }
  );
  if (denied.status !== 403 && denied.status !== 404) {
    throw new Error(`stranger list expected 403/404, got ${denied.status}`);
  }
  ok("stranger cannot access shared folder");

  // --- 6. Link share + verify ---
  await actAs(USERS.owner);
  const linkShare = await api("POST", `/api/files/${uploaded.id}/share`, {
    body: { label: "smoke-link", maxViews: 5 },
    expect: 200,
  });
  const token = linkShare.data.token ?? linkShare.data.share?.token;
  if (!token) throw new Error("no share token returned");
  ok(`created link share (${token.slice(0, 8)}…)`);

  jar.clear();
  currentUser = null;
  const verify = await api("POST", `/api/share/${token}`, { body: {}, expect: 200 });
  if (!verify.data.file?.name) {
    throw new Error("share verify did not return file metadata");
  }
  ok("anonymous share verify works");

  // --- 7. Download ---
  await actAs(USERS.owner);
  const dl = await fetch(`${BASE}/api/files/download/${uploaded.id}`, {
    headers: { Cookie: cookieHeader() ?? "" },
  });
  if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
  const content = await dl.text();
  if (!content.includes("Hello from smoke test")) {
    throw new Error("download content mismatch");
  }
  ok("owner can download file");

  // --- 8. Trash + list trash ---
  const trashBefore = await api("GET", "/api/files/list?trashed=1", { expect: 200 });
  const alreadyTrashed = trashBefore.data.items?.some((i) => i.id === uploaded.id);
  if (!alreadyTrashed) {
    await api("DELETE", `/api/files/${uploaded.id}`, { expect: 200 });
    ok("file moved to trash");
  } else {
    ok("file already in trash");
  }

  const trashList = await api("GET", "/api/files/list?trashed=1", { expect: 200 });
  if (!trashList.data.items?.some((i) => i.id === uploaded.id)) {
    throw new Error("trashed file not in trash view");
  }
  ok("file appears in trash");

  await api("PATCH", `/api/files/${uploaded.id}`, { expect: 200 });
  ok("file restored from trash");

  // --- 9. Password-protected public share ---
  await actAs(USERS.owner);
  const pwName = `secret_${TS}.txt`;
  const pwForm = new FormData();
  pwForm.append(
    "files",
    new File(["top secret smoke"], pwName, { type: "text/plain" })
  );
  const pwUp = await api("POST", "/api/files/upload", { form: pwForm, expect: 200 });
  const pwFileId = pwUp.data.created?.[0]?.id;
  if (!pwFileId) throw new Error("password-share upload failed");

  const pwShare = await api("POST", `/api/files/${pwFileId}/share`, {
    body: { label: "smoke-pw", password: "SmokeSecret1!" },
    expect: 200,
  });
  const pwToken = pwShare.data.token ?? pwShare.data.share?.token;
  if (!pwToken) throw new Error("no password share token");
  ok("created password-protected share");

  jar.clear();
  currentUser = null;
  await api("POST", `/api/share/${pwToken}`, { body: {}, expect: 401 });
  ok("password share rejects verify without password");

  const pwVerify = await api("POST", `/api/share/${pwToken}`, {
    body: { password: "SmokeSecret1!" },
    expect: 200,
  });
  if (!pwVerify.data.file?.name) {
    throw new Error("password verify did not return file");
  }
  ok("password share verifies with correct password");

  const pwDl = await fetch(`${BASE}/api/files/download/${pwFileId}?token=${pwToken}`, {
    headers: { Cookie: cookieHeader() ?? "" },
  });
  if (!pwDl.ok) throw new Error(`password share download failed: ${pwDl.status}`);
  const pwBody = await pwDl.text();
  if (!pwBody.includes("top secret smoke")) {
    throw new Error("password share download content mismatch");
  }
  ok("password share download works with verify cookies");

  // --- 10. Owner chunked upload (2 chunks) ---
  await actAs(USERS.owner);
  const chunkName = `chunked_${TS}.bin`;
  const partA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const partB = new Uint8Array([9, 10, 11, 12]);
  const chunkTotalSize = partA.length + partB.length;
  const uploadId = `smoke-chunk-${TS}`;

  async function postChunk(index, bytes) {
    const headers = {
      "x-upload-id": uploadId,
      "x-file-name": encodeURIComponent(chunkName),
      "x-file-size": String(chunkTotalSize),
      "x-file-mime": "application/octet-stream",
      "x-chunk-index": String(index),
      "x-chunk-total": "2",
      "content-type": "application/octet-stream",
    };
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    const res = await fetch(
      `${BASE}/api/files/upload-chunk?parentId=${folderId}`,
      { method: "POST", headers, body: bytes }
    );
    absorbCookies(res);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`chunk ${index} failed ${res.status}: ${JSON.stringify(data)}`);
    }
    return data;
  }

  const c0 = await postChunk(0, partA);
  if (c0.finalized) throw new Error("chunk 0 should not finalize");
  const c1 = await postChunk(1, partB);
  if (!c1.finalized || !c1.file?.id) {
    throw new Error(`chunk finalize failed: ${JSON.stringify(c1)}`);
  }
  ok("owner 2-chunk upload finalized");

  const chunkDl = await fetch(`${BASE}/api/files/download/${c1.file.id}`, {
    headers: { Cookie: cookieHeader() ?? "" },
  });
  if (!chunkDl.ok) throw new Error(`chunk download failed: ${chunkDl.status}`);
  const chunkBytes = new Uint8Array(await chunkDl.arrayBuffer());
  const expected = new Uint8Array(chunkTotalSize);
  expected.set(partA, 0);
  expected.set(partB, partA.length);
  if (chunkBytes.length !== expected.length ||
      chunkBytes.some((b, i) => b !== expected[i])) {
    throw new Error("chunked upload download bytes mismatch");
  }
  ok("chunked upload download matches assembled bytes");

  // --- 11. Thumbnail for a tiny PNG ---
  const pngB64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pngBytes = Buffer.from(pngB64, "base64");
  const thumbName = `thumb_${TS}.png`;
  const thumbForm = new FormData();
  thumbForm.append(
    "files",
    new File([pngBytes], thumbName, { type: "image/png" })
  );
  const thumbUp = await api("POST", `/api/files/upload?parentId=${folderId}`, {
    form: thumbForm,
    expect: 200,
  });
  const thumbId = thumbUp.data.created?.[0]?.id;
  if (!thumbId) throw new Error("thumbnail upload failed");
  const thumbRes = await fetch(
    `${BASE}/api/files/thumbnail/${thumbId}?size=64`,
    { headers: { Cookie: cookieHeader() ?? "" } }
  );
  if (!thumbRes.ok) throw new Error(`thumbnail failed: ${thumbRes.status}`);
  if (!thumbRes.headers.get("content-type")?.includes("image/jpeg")) {
    throw new Error("thumbnail content-type is not jpeg");
  }
  ok("owner thumbnail returns jpeg");

  // --- 12. users/search roster excludes self ---
  const search = await api("GET", "/api/users/search", { expect: 200 });
  const foundSelf = search.data.users?.some((u) => u.username === USERS.owner);
  if (foundSelf) throw new Error("users/search included the caller");
  if (!search.data.users?.some((u) => u.username === USERS.guest)) {
    throw new Error("users/search missing guest");
  }
  ok("users/search roster excludes self");

  // --- 13. Empty trash permanently deletes a throwaway file ---
  const trashName = `purge_${TS}.txt`;
  const trashForm = new FormData();
  trashForm.append(
    "files",
    new File(["bye"], trashName, { type: "text/plain" })
  );
  const trashUp = await api("POST", "/api/files/upload", {
    form: trashForm,
    expect: 200,
  });
  const purgeId = trashUp.data.created?.[0]?.id;
  if (!purgeId) throw new Error("purge upload failed");
  await api("DELETE", `/api/files/${purgeId}`, { expect: 200 });
  await api("POST", "/api/files/empty-trash", { expect: 200 });
  const trashAfter = await api("GET", "/api/files/list?trashed=1", { expect: 200 });
  if (trashAfter.data.items?.some((i) => i.id === purgeId)) {
    throw new Error("empty-trash left the purged file");
  }
  ok("empty-trash permanently removes trashed files");

  // --- 14. Logout invalidates session ---
  await actAs(USERS.owner);
  await api("POST", "/api/auth/logout", { expect: 200 });
  currentUser = null;
  // Cookie may linger in the jar; server-side tokenVersion bump must reject it.
  const afterLogout = await api("GET", "/api/files/list", { expect: 401 });
  if (afterLogout.data?.error === undefined) {
    throw new Error("expected auth error after logout");
  }
  ok("logout invalidates session (old cookie rejected)");

  console.log("\n✅ All smoke checks passed.\n");
  console.log("Test users (password for all: SmokeTest1!):");
  for (const [role, name] of Object.entries(USERS)) {
    console.log(`  ${role}: ${name}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err.message ?? err);
  process.exit(1);
});
