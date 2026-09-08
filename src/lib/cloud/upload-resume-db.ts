/**
 * IndexedDB persistence for in-flight chunked uploads.
 * Survives tab close so the user can continue large uploads.
 */

const DB_NAME = "doma-upload-resume";
const DB_VERSION = 1;
const STORE = "pending";

export interface PendingUploadRecord {
  /** Stable server upload session id (X-Upload-Id). */
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileMime: string;
  lastModified: number;
  parentId: string | null;
  sharedFolderId: string | null;
  chunkTotal: number;
  /** Optimistic watermark — confirm with GET status before skipping. */
  nextChunkIndex: number;
  /** File bytes for resume without re-picking. */
  blob: Blob;
  updatedAt: number;
  ownerUserId: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "uploadId" });
        store.createIndex("byOwner", "ownerUserId", { unique: false });
        store.createIndex("byUpdated", "updatedAt", { unique: false });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function putPendingUpload(rec: PendingUploadRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).put(rec));
  } finally {
    db.close();
  }
}

export async function getPendingUpload(uploadId: string): Promise<PendingUploadRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await idbReq(tx.objectStore(STORE).get(uploadId));
    return (row as PendingUploadRecord | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function listPendingUploads(ownerUserId: string): Promise<PendingUploadRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const idx = store.index("byOwner");
    const rows = await idbReq(idx.getAll(ownerUserId));
    const list = (rows as PendingUploadRecord[]) ?? [];
    // Drop stale entries approaching the server's 48h cleanup window.
    const maxAgeMs = 47 * 3600_000;
    const now = Date.now();
    return list
      .filter((r) => now - r.updatedAt < maxAgeMs)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function deletePendingUpload(uploadId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).delete(uploadId));
  } finally {
    db.close();
  }
}

export async function deletePendingUploads(uploadIds: string[]): Promise<void> {
  await Promise.all(uploadIds.map((id) => deletePendingUpload(id)));
}

export function blobToFile(rec: PendingUploadRecord): File {
  return new File([rec.blob], rec.fileName, {
    type: rec.fileMime || "application/octet-stream",
    lastModified: rec.lastModified || Date.now(),
  });
}
