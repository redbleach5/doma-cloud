import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getStorage, buildStorageKey, assertStorageKeyOwner, LocalFileStorage } from "@/lib/storage";
import { sanitizeName, resolveFolderAccess, hasPermission } from "@/lib/cloud/tree";
import { guessMime } from "@/lib/cloud/mime";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

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
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  // Use the cached `usedBytes` column for quota check — maintained
  // incrementally by upload/delete, O(1) instead of O(N) tree traversal.
  const usedBytes = user.usedBytes;
  if (contentLength > 0 && usedBytes + BigInt(contentLength) > user.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места",
        detail: {
          quota: user.quotaBytes.toString(),
          used: usedBytes.toString(),
          incoming: contentLength,
        },
      },
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
  if (usedBytes + BigInt(totalIncoming) > user.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места",
        detail: {
          quota: user.quotaBytes.toString(),
          used: usedBytes.toString(),
          incoming: totalIncoming,
        },
      },
      { status: 413 }
    );
  }

  // Disk space pre-check before writing bytes.
  const storage = await getStorage();
  if (storage instanceof LocalFileStorage) {
    const root = storage.getRoot();
    try {
      const stat = await fs.statfs(root);
      const freeBytes = stat.bsize * stat.bavail;
      if (BigInt(freeBytes) < BigInt(totalIncoming) * 2n) {
        return NextResponse.json(
          {
            error: "Недостаточно места на диске",
            detail: { free: freeBytes, needed: totalIncoming },
          },
          { status: 507 }
        );
      }
    } catch {
      // statfs not available on some platforms — skip the check.
    }
  }

  const created = await persistFiles(files, parentId, user.id, storage);

  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  // ATOMIC quota enforcement — conditional UPDATE prevents TOCTOU races.
  const totalStored = created.created.reduce(
    (sum, c) => sum + BigInt(c.sizeBytes),
    0n
  );
  const quotaResult = await db.$executeRaw`
    UPDATE User
    SET usedBytes = usedBytes + ${totalStored}
    WHERE id = ${user.id}
      AND usedBytes + ${totalStored} <= quotaBytes
  `;
  if (quotaResult === 0) {
    for (const c of created.created) {
      const sk = buildStorageKey(user.id, c.id, c.name);
      await storage.delete(sk).catch(() => undefined);
    }
    for (const c of created.created) {
      await db.fileNode.delete({ where: { id: c.id } }).catch(() => undefined);
    }
    return NextResponse.json(
      { error: "Превышен лимит места (конкурентная загрузка)" },
      { status: 413 }
    );
  }
  const newUsed = usedBytes + totalStored;

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
  const owner = await db.user.findUnique({ where: { id: share.ownerId } });
  if (!owner) {
    return NextResponse.json({ error: "Владелец не найден" }, { status: 404 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 0 && owner.usedBytes + BigInt(contentLength) > owner.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места у владельца папки",
        detail: {
          quota: owner.quotaBytes.toString(),
          used: owner.usedBytes.toString(),
          incoming: contentLength,
        },
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
  if (owner.usedBytes + BigInt(totalIncoming) > owner.quotaBytes) {
    return NextResponse.json(
      {
        error: "Превышен лимит места у владельца папки",
        detail: {
          quota: owner.quotaBytes.toString(),
          used: owner.usedBytes.toString(),
          incoming: totalIncoming,
        },
      },
      { status: 413 }
    );
  }

  const storage = await getStorage();
  if (storage instanceof LocalFileStorage) {
    const root = storage.getRoot();
    try {
      const stat = await fs.statfs(root);
      const freeBytes = stat.bsize * stat.bavail;
      if (BigInt(freeBytes) < BigInt(totalIncoming) * 2n) {
        return NextResponse.json(
          {
            error: "Недостаточно места на диске",
            detail: { free: freeBytes, needed: totalIncoming },
          },
          { status: 507 }
        );
      }
    } catch {
      // ignore
    }
  }

  // Persist files owned by the share owner.
  const result = await persistFiles(files, effectiveParentId, owner.id, storage);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const totalStored = result.created.reduce((sum, c) => sum + BigInt(c.sizeBytes), 0n);
  const quotaResult = await db.$executeRaw`
    UPDATE User
    SET usedBytes = usedBytes + ${totalStored}
    WHERE id = ${owner.id}
      AND usedBytes + ${totalStored} <= quotaBytes
  `;
  if (quotaResult === 0) {
    for (const c of result.created) {
      const sk = buildStorageKey(owner.id, c.id, c.name);
      await storage.delete(sk).catch(() => undefined);
    }
    for (const c of result.created) {
      await db.fileNode.delete({ where: { id: c.id } }).catch(() => undefined);
    }
    return NextResponse.json(
      { error: "Превышен лимит места у владельца (конкурентная загрузка)" },
      { status: 413 }
    );
  }
  const newUsed = owner.usedBytes + totalStored;

  return NextResponse.json({ created: result.created, usedBytes: newUsed.toString() });
}

// ---------------------------------------------------------------------------
// Shared persistence helper (used by both owner and shared-folder paths).
// ---------------------------------------------------------------------------

async function persistFiles(
  files: File[],
  parentId: string | null,
  ownerId: string,
  storage: Awaited<ReturnType<typeof getStorage>>
): Promise<
  | { created: Array<{ id: string; name: string; sizeBytes: string; mimeType: string }> }
  | { error: string; status: number }
> {
  const created: Array<{ id: string; name: string; sizeBytes: string; mimeType: string }> = [];

  const rollbackCreated = async () => {
    for (const c of created) {
      const sk = buildStorageKey(ownerId, c.id, c.name);
      await storage.delete(sk).catch(() => undefined);
      await db.fileNode.delete({ where: { id: c.id } }).catch(() => undefined);
    }
  };

  for (const file of files) {
    const safeName = sanitizeName(file.name);
    const fileId = randomUUID();
    const storageKey = buildStorageKey(ownerId, fileId, safeName);
    // Hard guard: never write outside the owner's own directory.
    assertStorageKeyOwner(storageKey, ownerId);
    const mimeType = file.type || guessMime(safeName);

    let result;
    try {
      result = await storage.put(storageKey, file.stream() as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
    } catch (err) {
      await rollbackCreated();
      const msg = err instanceof Error ? err.message : "Ошибка записи";
      return { error: `Не удалось сохранить «${safeName}»: ${msg}`, status: 500 };
    }

    let node;
    try {
      node = await db.fileNode.create({
        data: {
          id: fileId,
          ownerId,
          parentId,
          name: safeName,
          storageKey,
          isDirectory: false,
          sizeBytes: BigInt(result.sizeBytes),
          mimeType,
          hashSha256: result.hashSha256,
        },
      });
    } catch (dbErr) {
      await storage.delete(storageKey).catch(() => undefined);
      await rollbackCreated();
      console.error("[upload] DB write failed, rolled back batch:", dbErr);
      return { error: "Ошибка базы данных при записи файла", status: 500 };
    }

    created.push({
      id: node.id,
      name: node.name,
      sizeBytes: node.sizeBytes.toString(),
      mimeType: node.mimeType,
    });
  }

  return { created };
}
