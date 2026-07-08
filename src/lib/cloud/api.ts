/**
 * Typed fetch helpers for the Doma Cloud API.
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
    const res = await fetch("/api/me", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async login(username: string, password: string): Promise<{ user: CurrentUser }> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return jsonOrThrow(res);
  },

  async register(input: {
    username: string;
    displayName?: string;
    password: string;
  }): Promise<{ user: CurrentUser; isFirstUser: boolean }> {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
  },

  async setupStatus(): Promise<{ needsSetup: boolean; userCount: number }> {
    const res = await fetch("/api/setup/status", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async listFiles(parentId: string | null, opts?: { trashed?: boolean }): Promise<{ items: FileItem[] }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (opts?.trashed) params.set("trashed", "1");
    const res = await fetch(`/api/files/list?${params}`, { cache: "no-store" });
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
    onProgress?: (pct: number, fileName?: string) => void
  ): Promise<{ created: FileItem[]; usedBytes: string }> {
    const created: FileItem[] = [];
    let lastUsedBytes = "0";

    for (const file of files) {
      if (file.size >= CHUNK_THRESHOLD) {
        const result = await uploadChunked(file, parentId, (pct) =>
          onProgress?.(pct, file.name)
        );
        created.push(result.file);
        lastUsedBytes = result.usedBytes;
      } else {
        const result = await uploadSingle(file, parentId, (pct) =>
          onProgress?.(pct, file.name)
        );
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

  async mkdir(name: string, parentId: string | null): Promise<{ id: string; name: string }> {
    const params = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
    const res = await fetch(`/api/files/mkdir${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return jsonOrThrow(res);
  },

  async rename(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/files/${id}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return jsonOrThrow(res);
  },

  async trash(id: string): Promise<void> {
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async restore(id: string): Promise<void> {
    const res = await fetch(`/api/files/${id}`, { method: "PATCH" });
    return jsonOrThrow(res);
  },

  async purge(id: string): Promise<void> {
    const res = await fetch(`/api/files/${id}?hard=1`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async createShare(id: string, opts: { password?: string; expiresAt?: string; maxViews?: number; oneTimeUse?: boolean }): Promise<{ token: string; url: string; expiresAt: string | null; maxViews: number | null; hasPassword: boolean }> {
    const res = await fetch(`/api/files/${id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return jsonOrThrow(res);
  },

  async listShares(id: string): Promise<{ shares: Array<{ id: string; token: string; url: string; expiresAt: string | null; maxViews: number | null; usedCount: number; hasPassword: boolean; createdAt: string }> }> {
    const res = await fetch(`/api/files/${id}/share`, { cache: "no-store" });
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

  downloadUrl(id: string, token?: string): string {
    const params = token ? `?token=${encodeURIComponent(token)}` : "";
    return `/api/files/download/${id}${params}`;
  },

  // ---- Profile ----

  async getProfile(): Promise<{ user: ProfileUser }> {
    const res = await fetch("/api/profile", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async updateProfile(input: {
    displayName?: string;
    birthday?: string | null;
    themePreference?: "light" | "dark" | "system" | null;
  }): Promise<{ user: ProfileUser }> {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await fetch("/api/profile/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return jsonOrThrow(res);
  },

  // ---- Admin: users ----

  async adminListUsers(): Promise<{ users: AdminUser[] }> {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminCreateUser(input: {
    username: string;
    displayName?: string;
    password: string;
    role?: "admin" | "user";
    quotaBytes?: string;
  }): Promise<{ user: AdminUser }> {
    const res = await fetch("/api/admin/users", {
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
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrThrow(res);
  },

  async adminDeleteUser(id: string): Promise<void> {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    return jsonOrThrow(res);
  },

  async adminResetPassword(id: string, newPassword: string): Promise<void> {
    const res = await fetch(`/api/admin/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    return jsonOrThrow(res);
  },

  // ---- Admin: stats & settings ----

  async adminGetStats(): Promise<AdminStats> {
    const res = await fetch("/api/admin/stats", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminGetSettings(): Promise<{ settings: SystemSettings }> {
    const res = await fetch("/api/admin/settings", { cache: "no-store" });
    return jsonOrThrow(res);
  },

  async adminUpdateSettings(input: Partial<{
    defaultQuotaBytes: string;
    registrationOpen: boolean;
    trashRetentionDays: number;
    maxChunkSizeBytes: string;
  }>): Promise<{ settings: SystemSettings }> {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
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
  registrationOpen: boolean;
  trashRetentionDays: number;
  maxChunkSizeBytes: string;
}

// ---------------------------------------------------------------------------
// Upload helpers — split out for clarity.
// ---------------------------------------------------------------------------

/** Files smaller than this use simple multipart upload (one request). */
const CHUNK_THRESHOLD = 8 * 1024 * 1024; // 8 MB

/** Chunk size for large-file streaming uploads. */
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

/** Max retries per chunk on transient network errors. */
const MAX_CHUNK_RETRIES = 3;

async function uploadSingle(
  file: File,
  parentId: string | null,
  onProgress?: (pct: number) => void
): Promise<{ created: FileItem[]; usedBytes: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/upload?${parentId ? `parentId=${encodeURIComponent(parentId)}` : ""}`);
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
    xhr.send(form);
  });
}

/**
 * Chunked upload — splits the file into CHUNK_SIZE pieces and POSTs each one.
 *
 * Each chunk request body is ≤5 MB, so the server's `formData()` / body
 * parser only ever buffers a tiny amount. The server concatenates chunks
 * into the final file when the last one arrives.
 *
 * Resumable: if a chunk fails, we retry up to MAX_CHUNK_RETRIES times.
 * If the user closes the tab, the server keeps the partial temp file;
 * a future re-upload with the same X-Upload-Id could resume (TODO).
 */
async function uploadChunked(
  file: File,
  parentId: string | null,
  onProgress?: (pct: number) => void
): Promise<{ file: FileItem; usedBytes: string }> {
  const uploadId = (await import("nanoid")).nanoid(16);
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const parentParam = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      try {
        const res = await fetch(`/api/files/upload-chunk${parentParam}`, {
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
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (onProgress) {
          const pct = Math.round(((i + 1) / totalChunks) * 100);
          onProgress(pct);
        }
        lastErr = null;
        // If this was the last chunk, the response includes the final file record.
        if (data.finalized) {
          return { file: data.file, usedBytes: data.usedBytes };
        }
        break; // success, move to next chunk
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        // Brief backoff before retry.
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }

    if (lastErr) {
      // Clean up partial upload on the server.
      await api.abortUpload(uploadId);
      throw new Error(`Чанк ${i + 1}/${totalChunks} не загрузился после ${MAX_CHUNK_RETRIES} попыток: ${lastErr.message}`);
    }
  }

  throw new Error("Загрузка завершилась без финализации");
}
