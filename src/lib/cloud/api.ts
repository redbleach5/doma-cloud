/**
 * Typed fetch helpers for the Doma Cloud API.
 *
 * Conventions:
 *   - All requests use `credentials: "include"` (the session cookie is
 *     httpOnly + same-origin, so this is the correct mode).
 *   - Every request has a 30s hard timeout via AbortSignal.timeout(). The
 *     one exception is file download (handled separately with streaming).
 *   - A global 401 handler redirects to the login page ONCE per session
 *     expiry — instead of letting every concurrent fetch surface its own
 *     toast. A module-level guard prevents redirect loops.
 *   - Network errors and timeouts are rethrown as Error with a friendly
 *     Russian message so the UI can display them verbatim.
 */

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "code"
  | "markdown"
  | "office"
  | "archive"
  | "other";

export interface FileItem {
  id: string;
  parentId: string | null;
  name: string;
  isDirectory: boolean;
  sizeBytes: string;
  mimeType: string;
  category: FileCategory;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True if the file/folder is reachable because someone shared it with
   *  the current user (i.e. the current user is NOT the owner). */
  isShared?: boolean;
  /** Permission level for shared items — undefined for owned items. */
  permission?: "view" | "upload" | "edit";
  /** SharedItem.id — set on top-level «Поделились со мной» rows so the
   *  client can open the share with the correct share record id. */
  sharedFolderId?: string;
}

/** Node (folder OR file) that someone shared with the current user. */
export interface SharedWithMeItem {
  id: string;                 // SharedItem.id
  folderId: string;           // FileNode.id (compat alias of nodeId)
  nodeId?: string;
  folderName: string;
  nodeName?: string;
  ownerDisplayName: string;
  ownerUsername: string;
  permission: "view" | "upload" | "edit";
  createdAt: string;
  isDirectory?: boolean;
  mimeType?: string;
  sizeBytes?: string;
  category?: FileCategory;
}

/** Node the current user has shared with another user. */
export interface MySharedFolderItem {
  id: string;                 // SharedItem.id
  folderId: string;
  nodeId?: string;
  folderName: string;
  nodeName?: string;
  recipientDisplayName: string;
  recipientUsername: string;
  permission: "view" | "upload" | "edit";
  createdAt: string;
  isDirectory?: boolean;
  mimeType?: string;
  sizeBytes?: string;
}

export interface PreviewableFile {
  id: string;
  name: string;
  sizeBytes: string;
  mimeType: string;
  category: FileCategory;
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes: string;
  usedBytes: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Global fetch wrapper — centralises auth redirect, timeout, and error shape.
// ---------------------------------------------------------------------------

/** Default request timeout. Downloads opt out via raw fetch(). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Guard against redirect loops when many requests fail with 401 at once. */
let redirectingToLogin = false;

function handleUnauthorized() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  // Login lives on `/` (CloudApp), not a separate /login route.
  if (typeof window !== "undefined") {
    const path = window.location.pathname + window.location.search;
    if (path === "/" || path.startsWith("/?")) {
      // Already on the login surface — don't reload into a loop.
      redirectingToLogin = false;
      return;
    }
    window.location.href = "/";
  }
}

/** Friendly Russian error messages for low-level network failures. */
function formatNetworkError(err: unknown): Error {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new Error("Сервер не ответил за 30 секунд. Проверьте соединение.");
  }
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return new Error("Не удалось подключиться к серверу. Сеть недоступна.");
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Extended request init — adds an optional timeoutMs knob. */
interface ApiFetchInit extends RequestInit {
  /**
   * Hard timeout in milliseconds. Defaults to 30s; chunk uploads override
   * to 5 minutes since slow uplinks can legitimately take that long.
   */
  timeoutMs?: number;
  /**
   * When true, a 401 is returned to the caller instead of redirecting to
   * the login screen. Used by login/register themselves (wrong password
   * is a 401, not an expired session).
   */
  skipAuthRedirect?: boolean;
}

/**
 * Wrapper around fetch that:
 *   - injects credentials + a timeout
 *   - on 401, triggers the global redirect to `/` (idempotent), unless
 *     skipAuthRedirect is set
 *   - returns the raw Response (callers parse JSON via jsonOrThrow)
 */
async function apiFetch(
  input: string,
  init: ApiFetchInit = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, skipAuthRedirect = false, ...fetchInit } = init;
  // Combine caller's signal (if any) with our timeout signal.
  // AbortSignal.any is available in modern browsers + Node 18+.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = fetchInit.signal;
  const combined =
    callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(input, {
      ...fetchInit,
      credentials: "include",
      signal: combined,
    });
  } catch (err) {
    // Don't redirect on AbortError from caller (user-initiated cancel).
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw formatNetworkError(err);
  }

  if (res.status === 401 && !skipAuthRedirect) {
    handleUnauthorized();
    throw new Error("Сессия истекла. Выполните вход снова.");
  }
  return res;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = body?.error ?? `HTTP ${res.status}`;
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  async me(): Promise<{ user: CurrentUser | null }> {
    // Note: /api/me returns 200 + {user: null} when not logged in — never 401.
    const res = await apiFetch("/api/me", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async login(username: string, password: string): Promise<{ user: CurrentUser }> {
    // Wrong credentials are a 401 — must not trigger the session-expired redirect.
    redirectingToLogin = false;
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      skipAuthRedirect: true,
    });
    return jsonOrThrow(res);
  },

  async register(input: {
    username: string;
    displayName?: string;
    password: string;
  }): Promise<{ user: CurrentUser; isFirstUser: boolean }> {
    redirectingToLogin = false;
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      skipAuthRedirect: true,
    });
    return jsonOrThrow(res);
  },

  async logout(): Promise<void> {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // Explicit logout — arm the redirect guard so the next /api/me 401
    // (which may arrive from a still-in-flight request) doesn't loop.
    redirectingToLogin = false;
  },

  async listFiles(
    parentId: string | null,
    opts?: {
      trashed?: boolean;
      sharedFolderId?: string;
      limit?: number;
      cursor?: string | null;
    }
  ): Promise<{ items: FileItem[]; nextCursor: string | null; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (opts?.trashed) params.set("trashed", "1");
    if (opts?.sharedFolderId) params.set("sharedFolderId", opts.sharedFolderId);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);
    const res = await apiFetch(`/api/files/list?${params}`, { cache: "no-store" });
    const data = await jsonOrThrow<{
      items: FileItem[];
      nextCursor?: string | null;
      hasMore?: boolean;
    }>(res);
    return {
      items: data.items,
      nextCursor: data.nextCursor ?? null,
      hasMore: data.hasMore ?? false,
    };
  },

  /** One random image from the caller's library (prefers photos older than 30 days). */
  async randomImage(): Promise<{ item: FileItem | null }> {
    const res = await apiFetch("/api/files/random-image", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /**
   * Upload files with automatic strategy selection:
   *
   *   - Files < CHUNK_THRESHOLD (8 MB) → single multipart POST (simple, fast)
   *   - Files ≥ CHUNK_THRESHOLD       → chunked streaming upload (crash-safe,
   *                                    memory-flat, resumable)
   *
   * For chunked uploads the file is split into CHUNK_SIZE pieces on the
   * client and each piece is POSTed separately with X-Upload-Id headers.
   * Memory on the server stays flat regardless of total file size.
   */
  async uploadFiles(
    files: File[],
    parentId: string | null,
    onProgress?: (pct: number, fileName?: string) => void,
    signal?: AbortSignal,
    opts?: {
      sharedFolderId?: string;
      /** Per-file resume: reuse server uploadId after tab close. */
      resumeForFile?: (file: File) => Promise<{
        uploadId: string;
        parentId?: string | null;
        sharedFolderId?: string | null;
      } | null>;
      /** Persist progress after each accepted chunk (IndexedDB). */
      onChunkProgress?: (info: {
        file: File;
        uploadId: string;
        chunkTotal: number;
        nextChunkIndex: number;
        parentId: string | null;
        sharedFolderId: string | null;
      }) => void | Promise<void>;
      /** Called after successful finalize so the client can drop IDB state. */
      onUploadComplete?: (info: { file: File; uploadId: string }) => void | Promise<void>;
    }
  ): Promise<{ created: FileItem[]; usedBytes: string }> {
    const created: FileItem[] = [];
    let lastUsedBytes = "0";

    for (const file of files) {
      if (signal?.aborted) throw new DOMException("Загрузка отменена", "AbortError");
      if (file.size >= CHUNK_THRESHOLD) {
        const resume = (await opts?.resumeForFile?.(file)) ?? null;
        const effectiveParentId =
          resume?.parentId !== undefined ? resume.parentId : parentId;
        const effectiveShared =
          resume?.sharedFolderId !== undefined
            ? resume.sharedFolderId
            : opts?.sharedFolderId;
        const result = await uploadChunked(
          file,
          effectiveParentId,
          (pct) => onProgress?.(pct, file.name),
          signal,
          {
            sharedFolderId: effectiveShared ?? undefined,
            resumeUploadId: resume?.uploadId,
            onChunkProgress: opts?.onChunkProgress
              ? (info) =>
                  opts.onChunkProgress!({
                    file,
                    parentId: effectiveParentId,
                    sharedFolderId: effectiveShared ?? null,
                    ...info,
                  })
              : undefined,
            onComplete: opts?.onUploadComplete
              ? (uploadId) => opts.onUploadComplete!({ file, uploadId })
              : undefined,
          }
        );
        created.push(result.file);
        lastUsedBytes = result.usedBytes;
      } else {
        const result = await uploadSingle(file, parentId, (pct) =>
          onProgress?.(pct, file.name), signal, opts);
        created.push(...result.created);
        lastUsedBytes = result.usedBytes;
      }
    }

    return { created, usedBytes: lastUsedBytes };
  },

  /** Abort an in-progress chunked upload (user cancelled). */
  async abortUpload(uploadId: string): Promise<void> {
    await fetch(`/api/files/upload-chunk?uploadId=${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  },

  /** Resume status for a chunked upload session (after tab close). */
  async getUploadStatus(uploadId: string): Promise<{
    exists: boolean;
    uploadId: string;
    fileName: string | null;
    fileSize: number | null;
    parentId: string | null;
    sharedFolderId: string | null;
    receivedChunks: number[];
    nextChunkIndex: number;
  }> {
    const res = await apiFetch(
      `/api/files/upload-chunk?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" }
    );
    if (res.status === 410) {
      return {
        exists: false,
        uploadId,
        fileName: null,
        fileSize: null,
        parentId: null,
        sharedFolderId: null,
        receivedChunks: [],
        nextChunkIndex: 0,
      };
    }
    return jsonOrThrow(res);
  },

  async mkdir(
    name: string,
    parentId: string | null,
    opts?: { sharedFolderId?: string }
  ): Promise<{ id: string; name: string }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (opts?.sharedFolderId) params.set("sharedFolderId", opts.sharedFolderId);
    const res = await apiFetch(`/api/files/mkdir?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return jsonOrThrow(res);
  },

  async rename(id: string, name: string): Promise<void> {
    const res = await apiFetch(`/api/files/${id}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return jsonOrThrow(res);
  },

  async trash(id: string): Promise<{ ok: boolean; usedBytes: string }> {
    const res = await apiFetch(`/api/files/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async restore(id: string): Promise<{ ok: boolean; usedBytes: string; movedToRoot: boolean }> {
    const res = await apiFetch(`/api/files/${id}`, { method: "PATCH" });
    return jsonOrThrow(res);
  },

  async purge(id: string): Promise<{ ok: boolean; usedBytes: string }> {
    const res = await apiFetch(`/api/files/${id}?hard=1`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  /** Move a file or folder into a different parent (null = root). */
  async move(
    id: string,
    parentId: string | null,
    opts?: { sharedFolderId?: string }
  ): Promise<{ ok: boolean; moved: boolean }> {
    const res = await apiFetch(`/api/files/${id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId, sharedFolderId: opts?.sharedFolderId }),
    });
    return jsonOrThrow(res);
  },

  /** Permanently delete every trashed node owned by the current user. */
  async emptyTrash(): Promise<{ ok: boolean; purgedCount: number; usedBytes: string }> {
    const res = await apiFetch(`/api/files/empty-trash`, { method: "POST" });
    return jsonOrThrow(res);
  },

  async createShare(
    id: string,
    opts: { password?: string; expiresAt?: string; maxViews?: number; oneTimeUse?: boolean; label?: string }
  ): Promise<{
    token: string;
    url: string;
    expiresAt: string | null;
    maxViews: number | null;
    hasPassword: boolean;
    oneTimeUse?: boolean;
    updated?: boolean;
  }> {
    const res = await apiFetch(`/api/files/${id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return jsonOrThrow(res);
  },

  async listShares(id: string): Promise<{ shares: Array<{ id: string; token: string; url: string; label: string | null; expiresAt: string | null; maxViews: number | null; usedCount: number; hasPassword: boolean; oneTimeUse: boolean; createdAt: string }> }> {
    const res = await apiFetch(`/api/files/${id}/share`, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /** Revoke (permanently delete) a share link by its token. */
  async revokeShare(fileId: string, token: string): Promise<void> {
    const res = await apiFetch(`/api/files/${fileId}/share/${token}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async verifyShare(token: string, password?: string): Promise<{ file: PreviewableFile; share: { expiresAt: string | null; maxViews: number | null; usedCount: number; hasPassword: boolean }; downloadUrl: string }> {
    const res = await fetch(`/api/share/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return jsonOrThrow(res);
  },

  // ---- Shared items (Google-Drive-style folder OR file with a user) ----

  /**
   * Share a folder or file with another user account. The recipient will
   * see it in «Общие» with the given permission.
   */
  async shareFolder(
    nodeId: string,
    recipientUsername: string,
    permission: "view" | "upload" | "edit"
  ): Promise<{ id: string; permission: "view" | "upload" | "edit"; recipientUsername: string; recipientDisplayName: string }> {
    const res = await apiFetch(`/api/files/${nodeId}/share-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientUsername, permission }),
    });
    return jsonOrThrow(res);
  },

  /** List all users the current user has shared `nodeId` with. */
  async listFolderShares(nodeId: string): Promise<{
    shares: Array<{
      id: string;
      recipientId: string;
      recipientUsername: string;
      recipientDisplayName: string;
      permission: "view" | "upload" | "edit";
      createdAt: string;
    }>;
  }> {
    const res = await apiFetch(`/api/files/${nodeId}/share-folder`, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /** Update the permission of an existing share (or revoke if `permission` is null). */
  async updateFolderShare(
    nodeId: string,
    shareId: string,
    permission: "view" | "upload" | "edit" | null
  ): Promise<void> {
    const res = await apiFetch(`/api/files/${nodeId}/share-folder/${shareId}`, {
      method: permission === null ? "DELETE" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: permission === null ? undefined : JSON.stringify({ permission }),
    });
    return jsonOrThrow(res);
  },

  /** List nodes that other users have shared with the current user. */
  async listSharedWithMe(): Promise<{ items: SharedWithMeItem[] }> {
    const res = await apiFetch(`/api/shares/shared-with-me`, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /** List nodes the current user has shared with others. */
  async listMyShares(): Promise<{ items: MySharedFolderItem[] }> {
    const res = await apiFetch(`/api/shares/my`, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /**
   * Household roster for the share dialog.
   * Empty query → all other accounts; otherwise username prefix search.
   */
  async searchUsers(query = ""): Promise<{ users: Array<{ id: string; username: string; displayName: string }> }> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const qs = params.toString();
    const res = await apiFetch(`/api/users/search${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  /** All other family accounts (alias of searchUsers with empty query). */
  async listFamilyUsers(): Promise<{ users: Array<{ id: string; username: string; displayName: string }> }> {
    return this.searchUsers("");
  },

  downloadUrl(id: string, token?: string): string {
    const params = token ? `?token=${encodeURIComponent(token)}` : "";
    return `/api/files/download/${id}${params}`;
  },

  /**
   * Download multiple files as one zip without buffering the archive in JS memory.
   * Submits a same-origin form POST so the browser streams the attachment natively.
   * Session cookie is included automatically.
   */
  downloadZip(ids: string[]): void {
    if (ids.length === 0) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/files/zip";
    form.style.display = "none";
    // Stay in this window — navigations with Content-Disposition:attachment
    // do not unload the SPA; the file just downloads.
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "ids";
    input.value = ids.join(",");
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  },

  /** Valid thumbnail sizes are 64 / 128 / 256 / 512 / 1024 / 2048 (server-validated). */
  thumbnailUrl(
    id: string,
    size: 64 | 128 | 256 | 512 | 1024 | 2048 = 256,
    token?: string
  ): string {
    const params = new URLSearchParams({ size: String(size) });
    if (token) params.set("token", token);
    return `/api/files/thumbnail/${id}?${params}`;
  },

  /** Public (no-auth) settings — registrationOpen + trashRetentionDays. */
  async getPublicSettings(): Promise<{ registrationOpen: boolean; trashRetentionDays: number }> {
    const res = await fetch("/api/public-settings", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  // ---- Profile ----

  async getProfile(): Promise<{ user: ProfileUser }> {
    const res = await apiFetch("/api/profile", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async updateProfile(input: {
    displayName?: string;
    birthday?: string | null;
    themePreference?: "light" | "dark" | "system" | null;
  }): Promise<{ user: ProfileUser }> {
    const res = await apiFetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await apiFetch("/api/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return jsonOrThrow(res);
  },

  // ---- Admin: users ----

  async adminListUsers(): Promise<{ users: AdminUser[] }> {
    const res = await apiFetch("/api/admin/users", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminCreateUser(input: {
    username: string;
    displayName?: string;
    password: string;
    role?: "admin" | "user";
    quotaBytes?: string;
  }): Promise<{ user: AdminUser }> {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async adminUpdateUser(
    id: string,
    input: {
      displayName?: string;
      role?: "admin" | "user";
      quotaBytes?: string;
      birthday?: string | null;
    }
  ): Promise<{ user: AdminUser }> {
    const res = await apiFetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async adminDeleteUser(id: string): Promise<void> {
    const res = await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async adminResetPassword(id: string, newPassword: string): Promise<void> {
    const res = await apiFetch(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    return jsonOrThrow(res);
  },

  // ---- Admin: stats & settings ----

  async adminGetStats(): Promise<AdminStats> {
    const res = await apiFetch("/api/admin/stats", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminGetSettings(): Promise<{ settings: SystemSettings }> {
    const res = await apiFetch("/api/admin/settings", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminUpdateSettings(input: Partial<{
    defaultQuotaBytes: string;
    adminQuotaBytes: string;
    registrationOpen: boolean;
    trashRetentionDays: number;
  }>): Promise<{ settings: SystemSettings }> {
    const res = await apiFetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  /** Recompute user.usedBytes from scratch (admin maintenance operation). */
  async adminRecomputeQuotas(): Promise<{
    ok: boolean;
    recomputed: number;
    users: Array<{ id: string; username: string; before: string; after: string; drift: string }>;
  }> {
    const res = await apiFetch("/api/admin/recompute-quotas", {
      method: "POST",
    });
    return jsonOrThrow(res);
  },

  // ---- Admin: storage ----

  async adminGetStorage(skipUsed = false): Promise<StorageStatus> {
    const url = skipUsed ? "/api/admin/storage?skipUsed=1" : "/api/admin/storage";
    const res = await apiFetch(url, { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminSetStorageRoot(
    storageLocalRoot: string | null
  ): Promise<{ ok: boolean; storageLocalRoot: string | null }> {
    const res = await apiFetch("/api/admin/storage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageLocalRoot }),
    });
    return jsonOrThrow(res);
  },
};

export interface ProfileUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes: string;
  usedBytes: string;
  birthday: string | null;
  themePreference: "light" | "dark" | "system" | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  quotaBytes: string;
  usedBytes: string;
  birthday: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminStats {
  users: {
    total: number;
    admins: number;
    active: number;
    neverLoggedIn: number;
  };
  storage: {
    totalQuotaBytes: string;
    usedBytes: string;
    trashBytes: string;
    fileCount: number;
    trashCount: number;
    sharesCount: number;
  };
  disk: {
    totalBytes?: number;
    freeBytes?: number;
    usedBytes?: number;
  };
  perUser: Array<{
    id: string;
    role: string;
    quotaBytes: string;
    createdAt: string;
    lastLoginAt: string | null;
  }>;
}

export interface SystemSettings {
  defaultQuotaBytes: string;
  adminQuotaBytes: string;
  registrationOpen: boolean;
  trashRetentionDays: number;
  storageLocalRoot: string | null;
}

export interface DiskInfo {
  mount: string;
  device: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  writable: boolean;
  readOnlyReason: string | null;
}

export interface StorageStatus {
  localRoot: string | null;
  localRootOk: boolean;
  localRootFreeBytes: number | null;
  localRootTotalBytes: number | null;
  localRootUsedBytes: number | null;
  mounts: DiskInfo[];
  supportsStatfs: boolean;
  dbConfiguredRoot: string | null;
  envConfiguredRoot: string | null;
}

// ---------------------------------------------------------------------------
// Upload helpers — split out for clarity.
// ---------------------------------------------------------------------------

/** Files smaller than this use simple multipart upload (one request). */
const CHUNK_THRESHOLD = 8 * 1024 * 1024; // 8 MB

/** Chunk size for large-file streaming uploads. */
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

/** Max retries per chunk on transient network / rate-limit errors. */
const MAX_CHUNK_RETRIES = 5;

async function uploadSingle(
  file: File,
  parentId: string | null,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  opts?: { sharedFolderId?: string }
): Promise<{ created: FileItem[]; usedBytes: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (opts?.sharedFolderId) params.set("sharedFolderId", opts.sharedFolderId);
    xhr.open("POST", `/api/files/upload?${params}`);
    // Credentials: same-origin is XHR's default, but make it explicit.
    xhr.withCredentials = true;
    // Generous timeout for slow uplinks (single multipart upload of up to 8 MB).
    xhr.timeout = 5 * 60_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else if (xhr.status === 401) {
        // Trigger the same global handler as apiFetch would.
        handleUnauthorized();
        reject(new Error("Сессия истекла. Выполните вход снова."));
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          msg = body?.error ?? msg;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Сеть недоступна"));
    xhr.ontimeout = () => reject(new Error("Сервер не ответил за 5 минут. Проверьте соединение."));
    xhr.onabort = () => reject(new DOMException("Загрузка отменена", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Загрузка отменена", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/**
 * Chunked upload — splits the file into CHUNK_SIZE pieces and POSTs each one.
 *
 * Resumable across tab closes when `resumeUploadId` is set: we ask the server
 * which chunks already landed and skip them. Network failures after retries
 * leave the server session intact (do NOT abort) so the user can continue later.
 * Explicit user cancel still aborts and wipes temp data.
 */
async function uploadChunked(
  file: File,
  parentId: string | null,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  opts?: {
    sharedFolderId?: string;
    resumeUploadId?: string;
    onChunkProgress?: (info: {
      uploadId: string;
      chunkTotal: number;
      nextChunkIndex: number;
    }) => void | Promise<void>;
    onComplete?: (uploadId: string) => void | Promise<void>;
  }
): Promise<{ file: FileItem; usedBytes: string }> {
  const uploadId =
    opts?.resumeUploadId ?? (await import("nanoid")).nanoid(16);
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const params = new URLSearchParams();
  if (parentId) params.set("parentId", parentId);
  if (opts?.sharedFolderId) params.set("sharedFolderId", opts.sharedFolderId);
  const parentParam = `?${params}`;

  let startIndex = 0;
  if (opts?.resumeUploadId) {
    try {
      const status = await api.getUploadStatus(opts.resumeUploadId);
      if (!status.exists) {
        // Session expired — start a fresh uploadId but keep going with new id.
        // (Caller should have cleaned IDB; we still finish the upload.)
      } else {
        startIndex = Math.min(status.nextChunkIndex, totalChunks);
        if (onProgress && startIndex > 0) {
          onProgress(Math.round((startIndex / totalChunks) * 100));
        }
      }
    } catch {
      startIndex = 0;
    }
  }

  // Persist session bookmark before first new chunk (covers brand-new uploads).
  await opts?.onChunkProgress?.({
    uploadId,
    chunkTotal: totalChunks,
    nextChunkIndex: startIndex,
  });

  for (let i = startIndex; i < totalChunks; i++) {
    if (signal?.aborted) {
      await api.abortUpload(uploadId).catch(() => undefined);
      throw new DOMException("Загрузка отменена", "AbortError");
    }
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      if (signal?.aborted) {
        await api.abortUpload(uploadId).catch(() => undefined);
        throw new DOMException("Загрузка отменена", "AbortError");
      }
      try {
        const res = await apiFetch(`/api/files/upload-chunk${parentParam}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Id": uploadId,
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Size": String(file.size),
            "X-File-Mime": file.type || "application/octet-stream",
            "X-Chunk-Index": String(i),
            "X-Chunk-Total": String(totalChunks),
          },
          body: chunk,
          signal,
          timeoutMs: 5 * 60_000,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const err = new Error(body?.error ?? `HTTP ${res.status}`) as Error & {
            status?: number;
            retryAfterMs?: number;
          };
          err.status = res.status;
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            const sec = parseInt(retryAfter, 10);
            if (Number.isFinite(sec) && sec > 0) err.retryAfterMs = sec * 1000;
          }
          throw err;
        }

        const data = await res.json();
        const next = i + 1;
        await opts?.onChunkProgress?.({
          uploadId,
          chunkTotal: totalChunks,
          nextChunkIndex: next,
        });
        if (onProgress) {
          onProgress(Math.round((next / totalChunks) * 100));
        }
        lastErr = null;
        if (data.finalized) {
          await opts?.onComplete?.(uploadId);
          return { file: data.file, usedBytes: data.usedBytes };
        }
        break;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          await api.abortUpload(uploadId).catch(() => undefined);
          throw err;
        }
        lastErr = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number })?.status;
        const retryAfterMs = (err as { retryAfterMs?: number })?.retryAfterMs;
        if (status === 429) {
          await new Promise((r) =>
            setTimeout(r, retryAfterMs ?? 2000 * (attempt + 1))
          );
        } else {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (lastErr) {
      // Leave server session for later resume — do not abort on network failure.
      throw new Error(
        `Чанк ${i + 1}/${totalChunks} не загрузился после ${MAX_CHUNK_RETRIES} попыток: ${lastErr.message}`
      );
    }
  }

  throw new Error("Загрузка завершилась без финализации");
}
