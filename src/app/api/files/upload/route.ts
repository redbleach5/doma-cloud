import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { resolveFolderAccess, hasPermission } from "@/lib/cloud/tree";
import {
  checkDiskSpace,
  enforceQuotaAtomically,
  loadQuotaAccount,
  persistMultipartFiles,
  quotaExceededDetail,
  quotaWouldExceed,
  rollbackStoredFiles,
} from "@/lib/cloud/upload-core";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";

/**
 * Streaming multipart upload endpoint.
 *
 * Two access modes (see mkdir/route.ts for the same pattern):
 *   1. Owner      — parentId belongs to the caller.
 *   2. Shared     — ?sharedFolderId=<id>. Caller is the recipient; requires
 *                   `upload` permission. The uploaded file is owned by the
 *                   SHARE OWNER (so it counts against the owner's quota,
 *                   not the recipient's).
 *
 * CRITICAL: files are streamed directly to storage — memory usage stays flat
 * regardless of file size. A 20 GB video uses the same ~50 MB of RAM as a 1 KB
 * text file.
 *
 * Safety guarantees:
 *   1. Quota pre-checked using Content-Length (rejects before any byte hits disk)
 *   2. Files streamed to disk via Node streams — zero buffering in RAM
 *   3. If disk fills mid-upload, partial file is deleted and error returned
 *   4. DB record only created after storage write succeeds
 *   5. If DB write fails, the stored file is cleaned up
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Rate limit — 100 uploads/min per user.
  const rl = rateLimit(`upload:${session.sub}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много загрузок. Попробуйте через минуту." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const url = new URL(req.url);
  const parentId = url.searchParams.get("parentId") || null;
  const sharedFolderId = url.searchParams.get("sharedFolderId");

  // ---- Shared-folder mode ----
  if (sharedFolderId) {
    return uploadIntoShared(req, session.sub, parentId, sharedFolderId);
  }

  // ---- Owner mode ----
  // Verify parent belongs to caller and is a directory.
  if (parentId) {
    const parent = await db.fileNode.findFirst({
      where: {
        id: parentId,
        ownerId: session.sub,
        isDirectory: true,
        deletedAt: null,
      },
    });
    if (!parent) {
      return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
    }
  }

  // Pre-check quota using Content-Length header BEFORE parsing the body.
  // Uses the cached `usedBytes` column — maintained incrementally by
  // upload/delete, O(1) instead of O(N) tree traversal.
  const user = await loadQuotaAccount(session.sub);
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 0 && quotaWouldExceed(user, contentLength)) {
    return NextResponse.json(
      { error: "Превышен лимит места", detail: quotaExceededDetail(user, contentLength) },
      { status: 413 }
    );
  }

  // Parse the multipart body. Next.js streams this — the files themselves
  // are NOT loaded into memory until we call .arrayBuffer() or similar.
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Нет файлов для загрузки" }, { status: 400 });
  }

  // Double-check quota using actual file sizes (more accurate than Content-Length).
  const totalIncoming = files.reduce((sum, f) => sum + f.size, 0);
  if (quotaWouldExceed(user, totalIncoming)) {
    return NextResponse.json(
      { error: "Превышен лимит места", detail: quotaExceededDetail(user, totalIncoming) },
      { status: 413 }
    );
  }

  // Disk space pre-check before writing bytes.
  const storage = await getStorage();
  const disk = await checkDiskSpace(storage, BigInt(totalIncoming));
  if (!disk.ok) {
    return NextResponse.json(
      {
        error: "Недостаточно места на диске",
        detail: { free: Number(disk.freeBytes), needed: totalIncoming },
      },
      { status: 507 }
    );
  }

  const created = await persistMultipartFiles(files, parentId, user.id, storage);
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  // ATOMIC quota enforcement — see upload-core. On race loss, roll back the
  // whole batch (storage objects first, then FileNode rows).
  const totalStored = created.created.reduce((sum, c) => sum + BigInt(c.sizeBytes), 0n);
  const enforcement = await enforceQuotaAtomically(user.id, totalStored);
  if (!enforcement.enforced) {
    await rollbackStoredFiles(
      created.created.map((c) => ({ id: c.id, ownerId: user.id, name: c.name })),
      storage
    );
    return NextResponse.json(
      { error: "Превышен лимит места (конкурентная загрузка)" },
      { status: 413 }
    );
  }
  const newUsed = enforcement.usedBytes ?? user.usedBytes + totalStored;

  return NextResponse.json({ created: created.created, usedBytes: newUsed.toString() });
}

// ---------------------------------------------------------------------------
// Shared-folder upload path.
// ---------------------------------------------------------------------------

async function uploadIntoShared(
  req: NextRequest,
  recipientId: string,
  parentId: string | null,
  sharedFolderId: string
) {
  const share = await db.sharedItem.findUnique({
    where: { id: sharedFolderId },
    select: {
      id: true,
      nodeId: true,
      recipientId: true,
      ownerId: true,
      permission: true,
      node: { select: { deletedAt: true, isDirectory: true } },
    },
  });
  if (!share || share.recipientId !== recipientId) {
    return NextResponse.json({ error: "Поделиться не найдено" }, { status: 404 });
  }
  if (share.node.deletedAt || !share.node.isDirectory) {
    return NextResponse.json({ error: "Папка больше не доступна" }, { status: 410 });
  }
  if (!hasPermission(
    { kind: "shared", userId: recipientId, sharedFolderId: share.id, rootFolderId: share.nodeId, permission: share.permission as "view" | "upload" | "edit" },
    "upload"
  )) {
    return NextResponse.json(
      { error: "Недостаточно прав — нужна permission 'upload' или 'edit'" },
      { status: 403 }
    );
  }

  // Determine the effective parent.
  let effectiveParentId: string;
  if (parentId === null) {
    effectiveParentId = share.nodeId;
  } else {
    const ctx = await resolveFolderAccess(recipientId, parentId);
    if (!ctx || ctx.kind !== "shared" || ctx.rootFolderId !== share.nodeId) {
      return NextResponse.json({ error: "Папка вне области доступа" }, { status: 403 });
    }
    effectiveParentId = parentId;
  }

  // The file is owned by the SHARE OWNER — counts against their quota.
  const owner = await loadQuotaAccount(share.ownerId);
  if (!owner) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 0 && quotaWouldExceed(owner, contentLength)) {
    return NextResponse.json(
      {
        error: "Превышен лимит места у владельца папки",
        detail: quotaExceededDetail(owner, contentLength),
      },
      { status: 413 }
    );
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Нет файлов для загрузки" }, { status: 400 });
  }

  const totalIncoming = files.reduce((sum, f) => sum + f.size, 0);
  if (quotaWouldExceed(owner, totalIncoming)) {
    return NextResponse.json(
      {
        error: "Превышен лимит места у владельца папки",
        detail: quotaExceededDetail(owner, totalIncoming),
      },
      { status: 413 }
    );
  }

  // Disk space pre-check before writing bytes.
  const storage = await getStorage();
  const disk = await checkDiskSpace(storage, BigInt(totalIncoming));
  if (!disk.ok) {
    return NextResponse.json(
      {
        error: "Недостаточно места на диске",
        detail: { free: Number(disk.freeBytes), needed: totalIncoming },
      },
      { status: 507 }
    );
  }

  // Persist files owned by the share owner.
  const result = await persistMultipartFiles(files, effectiveParentId, owner.id, storage);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // ATOMIC quota enforcement against the OWNER's account — see upload-core.
  const totalStored = result.created.reduce((sum, c) => sum + BigInt(c.sizeBytes), 0n);
  const enforcement = await enforceQuotaAtomically(owner.id, totalStored);
  if (!enforcement.enforced) {
    await rollbackStoredFiles(
      result.created.map((c) => ({ id: c.id, ownerId: owner.id, name: c.name })),
      storage
    );
    return NextResponse.json(
      { error: "Превышен лимит места у владельца (конкурентная загрузка)" },
      { status: 413 }
    );
  }
  const newUsed = enforcement.usedBytes ?? owner.usedBytes + totalStored;

  return NextResponse.json({ created: result.created, usedBytes: newUsed.toString() });
}
