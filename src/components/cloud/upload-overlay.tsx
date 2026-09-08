"use client";

import * as React from "react";
import { api } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, X, UploadCloud, AlertCircle, RotateCw, WifiOff } from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { toast } from "sonner";
import {
  putPendingUpload,
  deletePendingUpload,
  type PendingUploadRecord,
} from "@/lib/cloud/upload-resume-db";

interface Props {
  files: File[];
  parentId: string | null;
  onDone: () => void;
  onCancel: () => void;
  /** When set, uploads go into a shared folder (recipient-side upload). */
  sharedFolderId?: string;
  /** Current user id — scopes IndexedDB resume records. */
  ownerUserId?: string;
  /**
   * Pre-seeded resume sessions (after tab close). Keyed by
   * `${name}|${size}|${lastModified}`.
   */
  resumeByFileKey?: Record<
    string,
    { uploadId: string; parentId?: string | null; sharedFolderId?: string | null }
  >;
}

interface UploadState {
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  /** Set while a chunk is being auto-retried after a transient failure. */
  retrying?: { attempt: number; delayMs: number; reason?: string } | null;
  /** Server-side upload session id — lets us resume the SAME session on retry. */
  uploadId?: string;
  /** True when the upload hit a transient error and is waiting to auto-retry. */
  waitingForRetry?: boolean;
  /** Permanent error (quota, auth) — no auto-retry. */
  permanentError?: string;
}

const retryingSet = new Set<string>();

function makeFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function fileResumeKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

interface FileEntry {
  file: File;
  id: string;
}

export function UploadOverlay({
  files,
  parentId,
  onDone,
  onCancel,
  sharedFolderId,
  ownerUserId,
  resumeByFileKey,
}: Props) {
  const uploadVisible = useCloudStore((s) => s.uploadVisible);
  const [states, setStates] = React.useState<Record<string, UploadState>>({});
  const [completedCount, setCompletedCount] = React.useState(0);
  const [errorCount, setErrorCount] = React.useState(0);
  const startedRef = React.useRef(false);
  const cancelRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const activeUploadIdsRef = React.useRef<Set<string>>(new Set());
  // Map fileId -> uploadId for manual/auto retries. Persisted across renders
  // so the SAME server session is resumed after a transient failure instead of
  // starting fresh.
  const resumeOverridesRef = React.useRef<Record<string, string>>({});
  // Map fileId -> uploadId so handleRetry can resume the SAME server session.
  const uploadIdByFileId = React.useRef<Record<string, string>>({});
  // Pending auto-retry timers per file — cancelled if a retry starts early.
  const retryTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Consecutive transient-failure count per file — drives the real backoff.
  const retryAttemptRef = React.useRef<Record<string, number>>({});
  // Trampoline for the declaration-order cycle:
  //   start → scheduleAutoRetry → handleRetry → start
  // scheduleAutoRetry is a hoisted function declared before handleRetry, and
  // its retry timer must reach the CURRENT handleRetry (React Compiler forbids
  // referencing a later-declared const). The ref is synced by an effect right
  // after handleRetry below; timers fire seconds later, so it is always fresh.
  const handleRetryRef = React.useRef<typeof handleRetry | null>(null);

  const onDoneRef = React.useRef(onDone);
  const onCancelRef = React.useRef(onCancel);
  React.useEffect(() => {
    onDoneRef.current = onDone;
    onCancelRef.current = onCancel;
  }, [onDone, onCancel]);

  const entries = React.useMemo<FileEntry[]>(
    () => files.map((file) => ({ file, id: makeFileId() })),
    [files]
  );

  const filesSignature = React.useMemo(
    () => entries.map((e) => `${e.id}:${e.file.name}:${e.file.size}`).join("|"),
    [entries]
  );
  const lastSigRef = React.useRef<string>("");
  React.useEffect(() => {
    if (filesSignature !== lastSigRef.current) {
      lastSigRef.current = filesSignature;
      cancelRef.current = true;
      if (abortRef.current) abortRef.current.abort();
      setStates({});
      setCompletedCount(0);
      setErrorCount(0);
      startedRef.current = false;
      cancelRef.current = false;
      activeUploadIdsRef.current.clear();
      for (const t of Object.values(retryTimersRef.current)) clearTimeout(t);
      retryTimersRef.current = {};
      retryAttemptRef.current = {};
      resumeOverridesRef.current = {};
    }
  }, [filesSignature]);

  const persistHooks = React.useMemo(() => {
    if (!ownerUserId) return {};
    return {
      resumeForFile: async (file: File) => {
        const key = fileResumeKey(file);
        // Priority 1: an in-session resume (from handleRetry / auto-retry) —
        // this reuses the EXACT server session we were just writing to.
        const override = resumeOverridesRef.current[key];
        if (override) {
          return { uploadId: override, parentId: null, sharedFolderId: null };
        }
        // Priority 2: cross-tab resume from IndexedDB (banner on mount).
        const hit = resumeByFileKey?.[key];
        if (!hit) return null;
        return {
          uploadId: hit.uploadId,
          parentId: hit.parentId ?? null,
          sharedFolderId: hit.sharedFolderId ?? null,
        };
      },
      onChunkProgress: async (info: {
        file: File;
        uploadId: string;
        chunkTotal: number;
        nextChunkIndex: number;
        parentId: string | null;
        sharedFolderId: string | null;
      }) => {
        activeUploadIdsRef.current.add(info.uploadId);
        // Remember the uploadId for this file so we can resume the SAME
        // server session after a transient failure (instead of restarting).
        const match = entries.find((e) => e.file === info.file);
        if (match) uploadIdByFileId.current[match.id] = info.uploadId;
        const rec: PendingUploadRecord = {
          uploadId: info.uploadId,
          fileName: info.file.name,
          fileSize: info.file.size,
          fileMime: info.file.type || "application/octet-stream",
          lastModified: info.file.lastModified,
          parentId: info.parentId,
          sharedFolderId: info.sharedFolderId,
          chunkTotal: info.chunkTotal,
          nextChunkIndex: info.nextChunkIndex,
          blob: info.file,
          updatedAt: Date.now(),
          ownerUserId,
        };
        await putPendingUpload(rec).catch(() => undefined);
      },
      onUploadComplete: async (info: { file: File; uploadId: string }) => {
        activeUploadIdsRef.current.delete(info.uploadId);
        await deletePendingUpload(info.uploadId).catch(() => undefined);
      },
    };
  }, [ownerUserId, resumeByFileKey, entries]);

  // Transient failures (network drop, 5xx, 429, timeout) self-heal — the user
  // never needs to press "Retry". Permanent errors (401, 413, 403, 400) surface
  // immediately so the user can fix the root cause.
  function isTransientUploadError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return false;
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 413 || status === 403 || status === 400) return false;
    if (status === undefined) return true; // network drop / timeout
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  // After a transient failure we DON'T surface a red error — instead we mark
  // the entry as waiting and schedule an automatic resume of the SAME server
  // session after a backoff. The user can close the tab or switch apps; the
  // upload self-heals without supervision.
  function scheduleAutoRetry(
    fileId: string,
    uploadId: string | undefined,
    reason: string
  ) {
    if (cancelRef.current) return;
    const attempt = (retryAttemptRef.current[fileId] ?? 0) + 1;
    retryAttemptRef.current[fileId] = attempt;
    const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(attempt - 1, 4));
    setStates((prev) => {
      const cur = prev[fileId] ?? { status: "pending", progress: 0 };
      return {
        ...prev,
        [fileId]: {
          ...cur,
          status: "uploading",
          retrying: { attempt, delayMs, reason },
          waitingForRetry: true,
        },
      };
    });
    // Replace any pending timer for this file — never let two fire.
    const prevTimer = retryTimersRef.current[fileId];
    if (prevTimer) clearTimeout(prevTimer);
    retryTimersRef.current[fileId] = setTimeout(() => {
      delete retryTimersRef.current[fileId];
      if (cancelRef.current) return;
      void handleRetryRef.current?.(fileId, uploadId);
    }, delayMs);
  }

  const start = React.useCallback(async (onlyIds?: Set<string>) => {
    const currentEntries = entries;
    if (currentEntries.length === 0) {
      onDoneRef.current();
      return;
    }
    const toProcess = onlyIds
      ? currentEntries.filter((e) => onlyIds.has(e.id))
      : currentEntries;
    if (toProcess.length === 0) return;

    if (!onlyIds) {
      setStates(() => {
        const next: Record<string, UploadState> = {};
        for (const e of currentEntries) next[e.id] = { status: "pending", progress: 0 };
        return next;
      });
      setCompletedCount(0);
      setErrorCount(0);
    } else {
      // Retrying specific entries — keep their current progress so the bar
      // doesn't jump to 0 while we resume the existing server session.
      setStates((s) => {
        const next = { ...s };
        for (const e of toProcess) {
          const cur = next[e.id];
          next[e.id] = cur
            ? { ...cur, status: "uploading", retrying: null, waitingForRetry: false }
            : { status: "uploading", progress: 0 };
        }
        return next;
      });
    }

    let doneCount = onlyIds ? completedCount : 0;
    let errCount = onlyIds ? errorCount : 0;
    for (const entry of toProcess) {
      if (cancelRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;

      const run = async () => {
        setStates((s) => {
          const cur = s[entry.id];
          // Keep the previous progress on a resume — the bar continues from
          // where the server session left off instead of flashing to 0.
          return {
            ...s,
            [entry.id]: {
              status: "uploading",
              progress: cur?.status === "uploading" ? (cur?.progress ?? 0) : 0,
              waitingForRetry: false,
            },
          };
        });
        try {
          await api.uploadFiles(
            [entry.file],
            parentId,
            (pct) => {
              setStates((s) => ({
                ...s,
                [entry.id]: { status: "uploading", progress: pct, retrying: null },
              }));
            },
            controller.signal,
            {
              ...(sharedFolderId ? { sharedFolderId } : {}),
              ...persistHooks,
              // Transient chunk failures retry automatically in api.uploadFiles —
              // surface that here so a paused progress bar doesn't read as a stall.
              onChunkRetry: async (info) => {
                setStates((s) => {
                  const prev = s[entry.id];
                  return {
                    ...s,
                    [entry.id]: {
                      status: "uploading",
                      progress: prev?.progress ?? 0,
                      retrying: {
                        attempt: info.attempt,
                        delayMs: info.delayMs,
                        reason: info.reason,
                      },
                    },
                  };
                });
              },
            }
          );
          setStates((s) => ({ ...s, [entry.id]: { status: "done", progress: 100 } }));
          doneCount += 1;
          setCompletedCount(doneCount);
          retryingSet.delete(entry.id);
          delete retryAttemptRef.current[entry.id];
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }
          const msg = err instanceof Error ? err.message : "Ошибка загрузки";
          // Permanent errors (auth, quota, bad request) surface immediately so
          // the user can fix the root cause. Transient failures (network, 5xx,
          // timeout) self-heal via scheduleAutoRetry — no supervision needed.
          if (!isTransientUploadError(err)) {
            setStates((s) => ({
              ...s,
              [entry.id]: { status: "error", progress: 0, error: msg, permanentError: msg },
            }));
            errCount += 1;
            setErrorCount(errCount);
            toast.error(`${entry.file.name}: ${msg}`);
            retryingSet.delete(entry.id);
            delete retryAttemptRef.current[entry.id];
          } else {
            // Free the retry slot so the scheduled resume can re-acquire it
            // (handleRetry refuses ids already in retryingSet).
            retryingSet.delete(entry.id);
            scheduleAutoRetry(entry.id, uploadIdByFileId.current[entry.id], msg);
          }
        } finally {
          abortRef.current = null;
        }
      };

      // Only one tab drives a given upload session (Web Locks). If another tab
      // is already resuming this uploadId, skip — it will finish over there.
      const resumeId = resumeByFileKey?.[fileResumeKey(entry.file)]?.uploadId;
      const locksApi = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (resumeId && locksApi) {
        const granted = (await locksApi.request(
          `doma-upload:${resumeId}`,
          { ifAvailable: true },
          run
        )) as unknown as Lock | null;
        if (!granted) {
          setStates((s) => ({
            ...s,
            [entry.id]: {
              status: "error",
              progress: 0,
              error: "Уже загружается в другой вкладке",
            },
          }));
          errCount += 1;
          setErrorCount(errCount);
          toast.error(`${entry.file.name}: уже загружается в другой вкладке`);
        }
      } else {
        await run();
      }
    }

    if (doneCount > 0 && !onlyIds) {
      toast.success(`Загружено файлов: ${doneCount} из ${currentEntries.length}`);
    } else if (doneCount > 0 && onlyIds) {
      toast.success(`Повторено: ${doneCount - completedCount}`);
    }

    const totalErrAfter = errCount;
    const totalDoneAfter = doneCount;
    if (totalErrAfter === 0 && totalDoneAfter === currentEntries.length) {
      setTimeout(() => {
        onDoneRef.current();
      }, 1200);
    }
  }, [entries, parentId, completedCount, errorCount, sharedFolderId, persistHooks]);

  React.useEffect(() => {
    if (uploadVisible && entries.length > 0 && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    if (!uploadVisible) startedRef.current = false;
  }, [uploadVisible, entries, start]);

  const handleCancel = React.useCallback(() => {
    cancelRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    // Kill any scheduled auto-retries — the user asked to stop.
    for (const t of Object.values(retryTimersRef.current)) clearTimeout(t);
    retryTimersRef.current = {};
    const ids = [...activeUploadIdsRef.current];
    for (const id of ids) {
      void api.abortUpload(id);
      void deletePendingUpload(id);
    }
    activeUploadIdsRef.current.clear();
    onCancelRef.current();
  }, []);

  const handleRetry = React.useCallback(
    (id: string, existingUploadId?: string) => {
      // Never two concurrent retry pipelines for the same file (double-click,
      // stale auto-retry timer + visibilitychange racing each other).
      if (retryingSet.has(id)) return;
      retryingSet.add(id);
      // A scheduled auto-retry is now moot — we're retrying right now.
      const pendingTimer = retryTimersRef.current[id];
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        delete retryTimersRef.current[id];
      }
      if (existingUploadId) {
        const entry = entries.find((e) => e.id === id);
        const key = entry ? fileResumeKey(entry.file) : null;
        if (key) resumeOverridesRef.current[key] = existingUploadId;
      }
      start(new Set([id]));
    },
    [start, entries]
  );

  // Keep the trampoline pointing at the latest handleRetry (see handleRetryRef).
  React.useEffect(() => {
    handleRetryRef.current = handleRetry;
  }, [handleRetry]);

  // When the tab returns to foreground (e.g. the browser froze it in the
  // background and killed the in-flight fetch), immediately resume uploads
  // that are waiting for an auto-retry. ONLY those: untouched queue entries
  // ("pending") are still handled by the sequential loop in start(), and
  // permanent errors need a human, not a retry.
  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (cancelRef.current) return;
      for (const entry of entries) {
        const st = states[entry.id];
        if (!st?.waitingForRetry) continue;
        if (retryingSet.has(entry.id)) continue;
        void handleRetry(entry.id, uploadIdByFileId.current[entry.id]);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [entries, states, handleRetry]);

  const handleRetryAll = React.useCallback(() => {
    const failedIds = new Set<string>();
    for (const entry of entries) {
      if (states[entry.id]?.status === "error") failedIds.add(entry.id);
    }
    if (failedIds.size === 0) return;
    failedIds.forEach((id) => retryingSet.add(id));
    start(failedIds);
  }, [entries, states, start]);

  if (!uploadVisible || entries.length === 0) return null;

  const allDone = completedCount === entries.length && errorCount === 0;
  const anyError = errorCount > 0;
  const finished = completedCount + errorCount === entries.length;

  return (
    <div className="fixed z-50 w-[calc(100vw-2rem)] max-w-sm animate-in slide-in-from-bottom-4 right-4 bottom-[max(4.5rem,calc(3.5rem+env(safe-area-inset-bottom)))] md:bottom-[max(1rem,env(safe-area-inset-bottom))]">
      <Card className="border-primary/20 shadow-2xl shadow-primary/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
          <div className="flex items-center gap-2 min-w-0">
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 text-chart-2 shrink-0" />
            ) : anyError && finished ? (
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            ) : (
              <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {allDone ? "Загрузка завершена" : anyError && finished ? "Загрузка с ошибками" : "Загружаем файлы"}
              </div>
              <div className="text-xs text-muted-foreground">
                {completedCount} / {entries.length}
                {!allDone && entries.length > 0 && (
                  <> · {formatBytes(entries.reduce((s, e) => s + e.file.size, 0))}</>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {finished && anyError && (
              <Button size="sm" variant="ghost" onClick={handleRetryAll} className="h-9 gap-1.5">
                <RotateCw className="h-3.5 w-3.5" />
                Повторить все
              </Button>
            )}
            {finished && (
              <Button size="sm" variant="ghost" onClick={onDone} className="h-9">
                {anyError ? "Закрыть" : "Готово"}
              </Button>
            )}
            {!finished && (
              <Button size="icon" variant="ghost" onClick={handleCancel} className="h-9 w-9" aria-label="Отменить">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {entries.map((entry) => {
            const st = states[entry.id] ?? { status: "pending", progress: 0 };
            return (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0">
                <div className="h-8 w-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                  {st.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-chart-2" />
                  ) : st.status === "error" ? (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  ) : st.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <UploadCloud className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium truncate">{entry.file.name}</div>
                    <div className="text-[11px] text-muted-foreground shrink-0">
                      {formatBytes(entry.file.size)}
                    </div>
                  </div>
                  {st.status === "uploading" && (
                    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden mt-1.5">
                      <div
                        className="relative h-full rounded-full transition-all duration-300 doma-flame-bar"
                        style={{ width: `${st.progress}%` }}
                      >
                        {st.progress > 0 && st.progress < 100 && (
                          <div
                            className="doma-flame-tongue absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-3 rounded-full"
                            style={{
                              background:
                                "radial-gradient(circle at 50% 80%, oklch(0.78 0.22 65), oklch(0.55 0.2 35) 60%, transparent)",
                              filter: "blur(0.5px)",
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                  {st.status === "uploading" && st.retrying && (
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      <WifiOff className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        Сеть нестабильна — повторяю попытку {st.retrying.attempt} через ~
                        {Math.max(1, Math.round(st.retrying.delayMs / 1000))} с…
                      </span>
                    </div>
                  )}
                  {st.status === "done" && (
                    <div className="relative h-1 rounded-full bg-chart-2/20 mt-1.5 overflow-hidden">
                      <div className="absolute inset-0 bg-chart-2/40 doma-glow-burst" />
                    </div>
                  )}
                  {st.status === "error" && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="text-[11px] text-destructive truncate flex-1">
                        {st.permanentError ?? st.error}
                      </div>
                      {st.permanentError && (
                        <button
                          onClick={() =>
                            handleRetry(entry.id, uploadIdByFileId.current[entry.id])
                          }
                          disabled={retryingSet.has(entry.id)}
                          className="text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-destructive/10 text-destructive transition shrink-0 disabled:opacity-50"
                          aria-label={`Повторить загрузку ${entry.file.name}`}
                        >
                          {retryingSet.has(entry.id) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="h-3 w-3" />
                          )}
                          Повторить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
