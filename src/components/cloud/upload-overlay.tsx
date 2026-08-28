"use client";

import * as React from "react";
import { api } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, X, UploadCloud, AlertCircle, RotateCw } from "lucide-react";
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
    }
  }, [filesSignature]);

  const persistHooks = React.useMemo(() => {
    if (!ownerUserId) return {};
    return {
      resumeForFile: async (file: File) => {
        const key = fileResumeKey(file);
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
  }, [ownerUserId, resumeByFileKey]);

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
      setStates((s) => {
        const next = { ...s };
        for (const e of toProcess) next[e.id] = { status: "pending", progress: 0 };
        return next;
      });
    }

    let doneCount = onlyIds ? completedCount : 0;
    let errCount = onlyIds ? errorCount : 0;
    for (const entry of toProcess) {
      if (cancelRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        setStates((s) => ({ ...s, [entry.id]: { status: "uploading", progress: 0 } }));
        await api.uploadFiles(
          [entry.file],
          parentId,
          (pct) => {
            setStates((s) => ({ ...s, [entry.id]: { status: "uploading", progress: pct } }));
          },
          controller.signal,
          {
            ...(sharedFolderId ? { sharedFolderId } : {}),
            ...persistHooks,
          }
        );
        setStates((s) => ({ ...s, [entry.id]: { status: "done", progress: 100 } }));
        doneCount += 1;
        setCompletedCount(doneCount);
        retryingSet.delete(entry.id);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        const msg = err instanceof Error ? err.message : "Ошибка загрузки";
        setStates((s) => ({ ...s, [entry.id]: { status: "error", progress: 0, error: msg } }));
        errCount += 1;
        setErrorCount(errCount);
        toast.error(`${entry.file.name}: ${msg}`);
        retryingSet.delete(entry.id);
      } finally {
        abortRef.current = null;
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
    const ids = [...activeUploadIdsRef.current];
    for (const id of ids) {
      void api.abortUpload(id);
      void deletePendingUpload(id);
    }
    activeUploadIdsRef.current.clear();
    onCancelRef.current();
  }, []);

  const handleRetry = React.useCallback((id: string) => {
    retryingSet.add(id);
    start(new Set([id]));
  }, [start]);

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
                  {st.status === "done" && (
                    <div className="relative h-1 rounded-full bg-chart-2/20 mt-1.5 overflow-hidden">
                      <div className="absolute inset-0 bg-chart-2/40 doma-glow-burst" />
                    </div>
                  )}
                  {st.status === "error" && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="text-[11px] text-destructive truncate flex-1">{st.error}</div>
                      <button
                        onClick={() => handleRetry(entry.id)}
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
