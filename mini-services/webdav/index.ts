/**
 * Doma WebDAV Server
 * ==================
 *
 * Стандартный WebDAV-эндпоинт для интеграции с нативными файловыми менеджерами:
 *   - iPhone/iPad:  Documents by Readdle, FE File Explorer
 *   - Android:      CX Проводник, Round Sync, Solid Explorer
 *   - Windows:      Проводник (Map Network Drive), RaiDrive
 *   - macOS:        Finder → Connect to Server
 *
 * URL:  http://<mini-pc>/dav/
 * Auth: HTTP Basic Auth (логин/пароль Doma)
 *
 * Поддерживаемые методы:
 *   OPTIONS    — discovery (возвращает DAV: 1, 2)
 *   PROPFIND   — метаданные файла/папки (Depth: 0 или 1)
 *   GET/HEAD   — скачивание файла (с Range support)
 *   PUT        — загрузка файла (стримом, без буферизации в память)
 *   MKCOL      — создание папки
 *   DELETE     — удаление (soft delete → корзина)
 *   MOVE       — переименование/перемещение
 *
 * Реализация: Bun.serve (поддерживает любые HTTP-методы), нативный SQLite
 * из `bun:sqlite` (без Prisma — минимум зависимостей).
 */

import { Database } from "bun:sqlite";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import { lookup as mimeLookup } from "node:path"; // placeholder, real lookup below

// --- Конфигурация ---

const PORT = 3001;
// Resolve DB path robustly. DATABASE_URL may be:
//   - "file:/abs/path/db.sqlite"  (Prisma absolute)
//   - "file:./db/doma.db"          (Prisma relative — relative to CWD)
//   - "/abs/path/db.sqlite"        (bare absolute)
// We strip the "file:" prefix and resolve relative paths against the project
// root (parent of mini-services/), NOT against the webdav service's own dir.
function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? "file:./db/doma.db").replace(/^file:/, "");
  if (path.isAbsolute(raw)) return raw;
  // Relative — resolve against project root (2 levels up from this file).
  const projectRoot = path.resolve(import.meta.dir, "..", "..");
  return path.resolve(projectRoot, raw);
}

const DB_PATH = resolveDbPath();
const STORAGE_ROOT = process.env.STORAGE_LOCAL_ROOT ?? path.join(import.meta.dir, "..", "..", "storage-data");
const DAV_PREFIX = "/dav";

// --- База данных ---

let db: Database;
try {
  db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Verify the schema is present (catches the "opened empty DB" footgun).
  const check = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='User'").get() as { name?: string } | null;
  if (!check?.name) {
    console.error(`[webdav] FATAL: DB at ${DB_PATH} has no User table.`);
    console.error(`[webdav] Did you run \`bun run db:push\` from the project root?`);
    console.error(`[webdav] The WebDAV service cannot start without a valid schema.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`[webdav] FATAL: Cannot open database at ${DB_PATH}:`, err);
  console.error(`[webdav] Check DATABASE_URL in your .env file.`);
  process.exit(1);
}

console.log(`[webdav] DB: ${DB_PATH}`);
console.log(`[webdav] Storage: ${STORAGE_ROOT}`);

// --- Типы ---

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  quotaBytes: number; // SQLite returns number for BIGINT with bun:sqlite
  usedBytes: number;
}

interface FileNodeRow {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  storageKey: string;
  isDirectory: number; // 0 or 1
  sizeBytes: number;
  mimeType: string;
  hashSha256: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Утилиты ---

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", heic: "image/heic", heif: "image/heif",
    bmp: "image/bmp", tiff: "image/tiff", svg: "image/svg+xml",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    mkv: "video/x-matroska", webm: "video/webm", m4v: "video/mp4",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg",
    m4a: "audio/mp4", aac: "audio/aac",
    pdf: "application/pdf",
    txt: "text/plain", md: "text/markdown", csv: "text/csv",
    json: "application/json", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml",
    zip: "application/zip", rar: "application/x-rar", "7z": "application/x-7z",
    gz: "application/gzip", tar: "application/x-tar",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return types[ext] ?? "application/octet-stream";
}

function sanitizeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 240) || "untitled";
}

function buildStorageKey(ownerId: string, fileId: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  return `${ownerId}/${fileId}/${safe}`;
}

function resolveStoragePath(storageKey: string): string {
  const resolved = path.resolve(STORAGE_ROOT, storageKey);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

function toHttpDate(date: Date | string | number): string {
  // Bun:sqlite returns DATETIME as epoch milliseconds (number).
  // Prisma returns ISO strings. Handle both.
  let d: Date;
  if (typeof date === "number") {
    d = new Date(date);
  } else if (typeof date === "string") {
    d = new Date(date);
  } else {
    d = date;
  }
  return d.toUTCString();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- Аутентификация ---

/**
 * Authenticate via HTTP Basic Auth.
 *
 * Username lookup is case-insensitive (matches the main app's behaviour):
 * we first try the exact username, then a COLLATE NOCASE lookup.
 * Returns null on any failure — the caller sends a 401 with WWW-Authenticate.
 */
function authenticate(req: Request): UserRow | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Basic ")) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
  } catch {
    return null;
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  if (!username || !password) return null;

  // Case-insensitive lookup: try exact match first, then COLLATE NOCASE.
  let user = db.query("SELECT * FROM User WHERE username = ?").get(username) as UserRow | null;
  if (!user) {
    user = db.query("SELECT * FROM User WHERE username = ? COLLATE NOCASE").get(username) as UserRow | null;
  }
  if (!user) return null;

  // Constant-time-ish password check (bcrypt handles timing internally).
  try {
    if (!bcrypt.compareSync(password, user.passwordHash)) return null;
  } catch {
    return null;
  }

  // Update lastLoginAt (fire-and-forget).
  db.query("UPDATE User SET lastLoginAt = ? WHERE id = ?").run(new Date().toISOString(), user.id);

  return user;
}

// --- Разбор пути ---

/**
 * Преобразует URL-путь в массив сегментов.
 * /dav/ → [] (root)
 * /dav/Photos/ → ['Photos']
 * /dav/Photos/cat.jpg → ['Photos', 'cat.jpg']
 */
function parsePath(urlPath: string): string[] {
  let p = urlPath;
  // Remove the DAV prefix
  if (p.startsWith(DAV_PREFIX)) p = p.slice(DAV_PREFIX.length);
  // Remove trailing slash (except for root)
  if (p.endsWith("/")) p = p.slice(0, -1);
  // Remove leading slash
  if (p.startsWith("/")) p = p.slice(1);
  if (!p) return [];
  return p.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
}

/** Восстанавливает URL-путь из сегментов. */
function buildPath(segments: string[]): string {
  return DAV_PREFIX + (segments.length === 0 ? "/" : "/" + segments.map(encodeURIComponent).join("/"));
}

// --- Разрешение узла по пути ---

async function resolveNode(ownerId: string, segments: string[]): Promise<FileNodeRow | "root" | null> {
  if (segments.length === 0) return "root";

  let parentId: string | null = null;
  let node: FileNodeRow | null = null;

  for (const segment of segments) {
    if (parentId === null) {
      node = db.query(
        "SELECT * FROM FileNode WHERE ownerId = ? AND parentId IS NULL AND name = ? AND deletedAt IS NULL"
      ).get(ownerId, segment) as FileNodeRow | null;
    } else {
      node = db.query(
        "SELECT * FROM FileNode WHERE ownerId = ? AND parentId = ? AND name = ? AND deletedAt IS NULL"
      ).get(ownerId, parentId, segment) as FileNodeRow | null;
    }
    if (!node) return null;
    parentId = node.id;
  }

  return node;
}

/** Список дочерних узлов. */
function listChildren(ownerId: string, parentId: string | null): FileNodeRow[] {
  if (parentId === null) {
    return db.query(
      "SELECT * FROM FileNode WHERE ownerId = ? AND parentId IS NULL AND deletedAt IS NULL ORDER BY isDirectory DESC, name ASC"
    ).all(ownerId) as FileNodeRow[];
  }
  return db.query(
    "SELECT * FROM FileNode WHERE ownerId = ? AND parentId = ? AND deletedAt IS NULL ORDER BY isDirectory DESC, name ASC"
  ).all(ownerId, parentId) as FileNodeRow[];
}

/** Создать или найти родителя по сегментам пути. Возвращает id последнего существующего предка. */
async function findParent(ownerId: string, segments: string[]): Promise<{ parentId: string | null; existsUntil: number }> {
  let parentId: string | null = null;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    let node: FileNodeRow | null;
    if (parentId === null) {
      node = db.query(
        "SELECT * FROM FileNode WHERE ownerId = ? AND parentId IS NULL AND name = ? AND deletedAt IS NULL"
      ).get(ownerId, segment) as FileNodeRow | null;
    } else {
      node = db.query(
        "SELECT * FROM FileNode WHERE ownerId = ? AND parentId = ? AND name = ? AND deletedAt IS NULL"
      ).get(ownerId, parentId, segment) as FileNodeRow | null;
    }
    if (!node) return { parentId, existsUntil: i };
    parentId = node.id;
  }
  return { parentId, existsUntil: segments.length - 1 };
}

// --- WebDAV XML-ответы ---

function propfindResponse(
  user: UserRow,
  basePath: string,
  node: FileNodeRow | "root",
  children: FileNodeRow[]
): string {
  const responses: string[] = [];

  // The requested resource itself
  responses.push(buildResponseEntry(basePath, node, user));

  // Children (only for Depth: 1)
  for (const child of children) {
    const childSegments = parsePath(basePath);
    childSegments.push(child.name);
    const childPath = buildPath(childSegments) + (child.isDirectory ? "/" : "");
    responses.push(buildResponseEntry(childPath, child, user));
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses.join("\n")}
</D:multistatus>`;
}

function buildResponseEntry(href: string, node: FileNodeRow | "root", _user: UserRow): string {
  const isRoot = node === "root";
  const isDir = isRoot || node.isDirectory === 1;
  const name = isRoot ? "Doma" : node.name;
  const size = isRoot ? 0 : node.sizeBytes;
  const lastModified = isRoot ? new Date().toISOString() : node.updatedAt;
  const contentType = isDir ? "httpd/unix-directory" : (isRoot ? "" : (node.mimeType || "application/octet-stream"));

  return `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(name)}</D:displayname>
        <D:resourcetype>${isDir ? "<D:collection/>" : ""}</D:resourcetype>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:getlastmodified>${escapeXml(toHttpDate(lastModified))}</D:getlastmodified>
        ${contentType ? `<D:getcontenttype>${escapeXml(contentType)}</D:getcontenttype>` : ""}
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

// --- HTTP-обработчики ---

function handleOptions(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "DAV": "1, 2",
      "MS-Author-Via": "DAV",
      "Allow": "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE",
      "Content-Length": "0",
    },
  });
}

async function handlePropfind(req: Request, user: UserRow, urlPath: string): Promise<Response> {
  const depth = req.headers.get("Depth") ?? "1";
  const segments = parsePath(urlPath);
  const node = await resolveNode(user.id, segments);

  if (node === null) {
    return new Response("Not Found", { status: 404 });
  }

  let children: FileNodeRow[] = [];
  if (depth === "1" || depth === "infinity") {
    const parentId = node === "root" ? null : node.id;
    children = listChildren(user.id, parentId);
    // Cap depth at 1 to avoid infinite recursion on huge trees.
    if (depth === "infinity") {
      // Only return immediate children — WebDAV clients usually accept this.
    }
  }

  const xml = propfindResponse(user, urlPath, node, children);
  return new Response(xml, {
    status: 207,
    headers: {
      "Content-Type": 'application/xml; charset="utf-8"',
      "DAV": "1, 2",
    },
  });
}

async function handleGet(req: Request, user: UserRow, urlPath: string, headOnly: boolean): Promise<Response> {
  const segments = parsePath(urlPath);
  const node = await resolveNode(user.id, segments);

  if (node === null || node === "root") {
    return new Response("Not Found", { status: 404 });
  }
  if (node.isDirectory) {
    return new Response("Is a directory", { status: 400 });
  }

  const filePath = resolveStoragePath(node.storageKey);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new Response("File missing on disk", { status: 500 });
  }

  // Range support for media playback
  const range = req.headers.get("range");
  if (range && !headOnly) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(filePath, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": node.mimeType,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
        },
      });
    }
  }

  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": node.mimeType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
        "Last-Modified": toHttpDate(stat.mtime),
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": node.mimeType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Last-Modified": toHttpDate(stat.mtime),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(node.name)}`,
    },
  });
}

async function handlePut(req: Request, user: UserRow, urlPath: string): Promise<Response> {
  const segments = parsePath(urlPath);
  if (segments.length === 0) {
    return new Response("Cannot PUT to root", { status: 403 });
  }

  const fileName = sanitizeName(segments[segments.length - 1]);
  const { parentId } = await findParent(user.id, segments);
  // Parent must exist (we don't auto-create intermediate folders via PUT).
  if (segments.length > 1 && parentId === null) {
    // Actually we need to verify the FULL parent chain exists.
    const parentSegments = segments.slice(0, -1);
    const parentNode = await resolveNode(user.id, parentSegments);
    if (parentNode === null || parentNode === "root") {
      return new Response("Parent folder not found", { status: 409 });
    }
  }

  // Verify parent is a directory (not a file).
  if (segments.length > 1) {
    const parentSegments = segments.slice(0, -1);
    const parentNode = await resolveNode(user.id, parentSegments);
    if (parentNode !== "root" && parentNode && !parentNode.isDirectory) {
      return new Response("Parent is not a directory", { status: 409 });
    }
  }

  // Check if file already exists — overwrite or create new.
  const existing = await resolveNode(user.id, segments);
  const fileId = existing && existing !== "root" ? existing.id : randomUUID();
  const storageKey = existing && existing !== "root" ? existing.storageKey : buildStorageKey(user.id, fileId, fileName);
  const filePath = resolveStoragePath(storageKey);

  // Quota check (only for new files).
  if (existing === null) {
    const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
    if (contentLength > 0) {
      const usedRow = db.query("SELECT usedBytes FROM User WHERE id = ?").get(user.id) as { usedBytes: number } | null;
      const quotaRow = db.query("SELECT quotaBytes FROM User WHERE id = ?").get(user.id) as { quotaBytes: number } | null;
      if (usedRow && quotaRow && usedRow.usedBytes + contentLength > quotaRow.quotaBytes) {
        return new Response("Quota exceeded", { status: 413 });
      }
    }
  }

  // Ensure directory exists.
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Stream the request body to disk — never buffer in memory.
  const writeStream = createWriteStream(filePath);
  const hash = createHash("sha256");
  let sizeBytes = 0;

  try {
    const body = req.body;
    if (body) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        sizeBytes += value.byteLength;
        writeStream.write(value);
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });
  } catch (err) {
    // Partial write — clean up.
    writeStream.destroy();
    await fs.unlink(filePath).catch(() => undefined);
    return new Response("Upload failed: " + (err as Error).message, { status: 500 });
  }

  const mimeType = req.headers.get("content-type") ?? guessMime(fileName);

  if (existing && existing !== "root") {
    // Overwrite — update existing record.
    db.query(
      "UPDATE FileNode SET sizeBytes = ?, mimeType = ?, hashSha256 = ?, updatedAt = ? WHERE id = ?"
    ).run(sizeBytes, mimeType, hash.digest("hex"), new Date().toISOString(), existing.id);
  } else {
    // Create new.
    db.query(
      `INSERT INTO FileNode (id, ownerId, parentId, name, storageKey, isDirectory, sizeBytes, mimeType, hashSha256, deletedAt, deletedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(
      fileId, user.id, parentId, fileName, storageKey,
      sizeBytes, mimeType, hash.digest("hex"),
      new Date().toISOString(), new Date().toISOString()
    );
  }

  // Update user.usedBytes (best-effort).
  updateUserUsedBytes(user.id);

  return new Response(null, { status: 201 });
}

async function handleMkcol(_req: Request, user: UserRow, urlPath: string): Promise<Response> {
  const segments = parsePath(urlPath);
  if (segments.length === 0) {
    return new Response("Root already exists", { status: 405 });
  }

  const dirName = sanitizeName(segments[segments.length - 1]);

  // Parent must exist.
  if (segments.length > 1) {
    const parentSegments = segments.slice(0, -1);
    const parentNode = await resolveNode(user.id, parentSegments);
    if (parentNode === null) {
      return new Response("Parent not found", { status: 409 });
    }
    if (parentNode !== "root" && !parentNode.isDirectory) {
      return new Response("Parent is not a directory", { status: 409 });
    }
  }

  // Check if already exists.
  const existing = await resolveNode(user.id, segments);
  if (existing !== null) {
    return new Response("Already exists", { status: 405 });
  }

  // Resolve parent ID.
  let parentId: string | null = null;
  if (segments.length > 1) {
    const parentSegments = segments.slice(0, -1);
    const parentNode = await resolveNode(user.id, parentSegments);
    if (parentNode && parentNode !== "root") {
      parentId = parentNode.id;
    }
  }

  const dirId = randomUUID();
  const storageKey = buildStorageKey(user.id, dirId, "");

  db.query(
    `INSERT INTO FileNode (id, ownerId, parentId, name, storageKey, isDirectory, sizeBytes, mimeType, hashSha256, deletedAt, deletedBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 1, 0, 'inode/directory', NULL, NULL, NULL, ?, ?)`
  ).run(dirId, user.id, parentId, dirName, storageKey, new Date().toISOString(), new Date().toISOString());

  return new Response(null, { status: 201 });
}

async function handleDelete(_req: Request, user: UserRow, urlPath: string): Promise<Response> {
  const segments = parsePath(urlPath);
  if (segments.length === 0) {
    return new Response("Cannot delete root", { status: 403 });
  }

  const node = await resolveNode(user.id, segments);
  if (node === null) {
    return new Response("Not Found", { status: 404 });
  }
  if (node === "root") {
    return new Response("Cannot delete root", { status: 403 });
  }

  // Soft delete — move to trash (consistent with web UI).
  const now = new Date().toISOString();
  markDeletedRecursive(node.id, user.id, now);

  updateUserUsedBytes(user.id);
  return new Response(null, { status: 204 });
}

function markDeletedRecursive(nodeId: string, userId: string, now: string) {
  db.query("UPDATE FileNode SET deletedAt = ?, deletedBy = ? WHERE id = ?").run(now, userId, nodeId);
  const children = db.query("SELECT id FROM FileNode WHERE parentId = ?").all(nodeId) as { id: string }[];
  for (const child of children) {
    markDeletedRecursive(child.id, userId, now);
  }
}

async function handleMove(req: Request, user: UserRow, urlPath: string): Promise<Response> {
  const destination = req.headers.get("destination");
  if (!destination) {
    return new Response("Missing Destination header", { status: 400 });
  }

  // Parse the destination URL — extract the path portion.
  const destUrl = new URL(destination);
  const destPath = destUrl.pathname;
  const destSegments = parsePath(destPath);

  if (destSegments.length === 0) {
    return new Response("Cannot move to root", { status: 403 });
  }

  const srcSegments = parsePath(urlPath);
  const srcNode = await resolveNode(user.id, srcSegments);
  if (srcNode === null || srcNode === "root") {
    return new Response("Source not found", { status: 404 });
  }

  // Check if destination already exists.
  const destExisting = await resolveNode(user.id, destSegments);
  if (destExisting !== null) {
    // If overwrite is not allowed, fail.
    if (req.headers.get("overwrite")?.toLowerCase() !== "t") {
      return new Response("Destination exists", { status: 412 });
    }
    // Delete the destination first.
    markDeletedRecursive(destExisting !== "root" ? destExisting.id : "", user.id, new Date().toISOString());
  }

  // Resolve new parent.
  const destParentSegments = destSegments.slice(0, -1);
  let newParentId: string | null = null;
  if (destParentSegments.length > 0) {
    const destParent = await resolveNode(user.id, destParentSegments);
    if (destParent === null) {
      return new Response("Destination parent not found", { status: 409 });
    }
    if (destParent !== "root") {
      newParentId = destParent.id;
    }
  }

  // #11 — Cycle protection: don't allow moving a folder into itself or
  // any of its descendants. This would create a cycle in the tree and
  // cause infinite recursion in computeDirectorySize and tree traversal.
  if (srcNode.isDirectory && newParentId !== null) {
    if (srcNode.id === newParentId) {
      return new Response("Cannot move a folder into itself", { status: 409 });
    }
    // Walk up the destination parent chain — if we hit srcNode, it's a cycle.
    let currentParentId: string | null = newParentId;
    while (currentParentId) {
      if (currentParentId === srcNode.id) {
        return new Response("Cannot move a folder into its own descendant", { status: 409 });
      }
      const parentRow = db.query("SELECT parentId FROM FileNode WHERE id = ?").get(currentParentId) as { parentId: string | null } | null;
      currentParentId = parentRow?.parentId ?? null;
    }
  }

  const newName = sanitizeName(destSegments[destSegments.length - 1]);

  db.query("UPDATE FileNode SET parentId = ?, name = ?, updatedAt = ? WHERE id = ?")
    .run(newParentId, newName, new Date().toISOString(), srcNode.id);

  return new Response(null, { status: 201 });
}

function updateUserUsedBytes(userId: string) {
  // Recompute by summing all non-deleted files of this user.
  const result = db.query(
    "SELECT COALESCE(SUM(sizeBytes), 0) AS total FROM FileNode WHERE ownerId = ? AND isDirectory = 0 AND deletedAt IS NULL"
  ).get(userId) as { total: number } | null;
  const total = result?.total ?? 0;
  db.query("UPDATE User SET usedBytes = ? WHERE id = ?").run(total, userId);
}

// --- Сервер ---

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const urlPath = url.pathname;

    // Health check — no auth needed.
    if (urlPath === "/webdav-health") {
      return new Response("ok", { status: 200 });
    }

    // Only handle /dav/* paths.
    if (!urlPath.startsWith(DAV_PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }

    // Authenticate.
    const user = authenticate(req);
    if (!user) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Doma WebDAV", charset="UTF-8"',
        },
      });
    }

    const method = req.method.toUpperCase();

    try {
      switch (method) {
        case "OPTIONS":
          return handleOptions();
        case "PROPFIND":
          return await handlePropfind(req, user, urlPath);
        case "GET":
          return await handleGet(req, user, urlPath, false);
        case "HEAD":
          return await handleGet(req, user, urlPath, true);
        case "PUT":
          return await handlePut(req, user, urlPath);
        case "MKCOL":
          return await handleMkcol(req, user, urlPath);
        case "DELETE":
          return await handleDelete(req, user, urlPath);
        case "MOVE":
          return await handleMove(req, user, urlPath);
        default:
          return new Response(`Method ${method} not allowed`, {
            status: 405,
            headers: { Allow: "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE" },
          });
      }
    } catch (err) {
      console.error(`[webdav] ${method} ${urlPath} → error:`, err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

console.log(`[webdav] Doma WebDAV server listening on http://localhost:${PORT}${DAV_PREFIX}/`);
console.log(`[webdav] Auth: HTTP Basic (Doma username/password)`);

// silence unused import
void mimeLookup;
void Readable;
void PassThrough;
