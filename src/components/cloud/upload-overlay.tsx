"use client";

import * as React from "react";
import { api } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, X, UploadCloud, AlertCircle } from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { toast } from "sonner";

interface Props {
  files: File[];
  parentId: string | null;
  onDone: () => void;
  onCancel: () => void;
}

interface UploadState {
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

/** Unique id for each file entry — survives duplicate names/sizes. */
function makeFileId(): string {
  // crypto.randomUUID is available in all modern browsers + secure contexts.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface FileEntry {
  file: File;
  id: string;
}

export function UploadOverlay({ files, parentId, onDone, onCancel }: Props) {
  const uploadVisible = useCloudStore((s) => s.uploadVisible);
  const [states, setStates] = React.useState<Record<string, UploadState>>({});
  const [completedCount, setCompletedCount] = React.useState(0);
  const [errorCount, setErrorCount] = React.useState(0);
  const startedRef = React.useRef(false);

  // cancelRef — set to true when the user clicks "✕" or when a fresh batch
  // supersedes the in-flight one. The running `start()` loop checks this flag
  // at the top of each iteration and bails out. Without this, dropping a
  // second batch while the first is still uploading would spawn two parallel
  // `start()` loops, each with its own stale closure of `files`.
  const cancelRef = React.useRef(false);

  // Track the AbortControllers for in-flight uploads so the user-visible
  // "Cancel" button can actually abort the HTTP request, not just hide the
  // overlay. Previously the upload kept running in the background after the
  // overlay was dismissed — wasting bandwidth, quota, and disk space.
  const abortRef = React.useRef<AbortController | null>(null);

  // Stable callbacks to avoid re-creating `start` on every parent render.
  const onDoneRef = React.useRef(onDone);
  const onCancelRef = React.useRef(onCancel);
  React.useEffect(() => {
    onDoneRef.current = onDone;
    onCancelRef.current = onCancel;
  }, [onDone, onCancel]);

  // Build a stable list of file entries with unique ids. The id is used as
  // the React key and as the state-lookup key — fixes the previous bug where
  // two files with the same name+size would collide and one would silently
  // disappear from the UI.
  const entries = React.useMemo<FileEntry[]>(
    () => files.map((file) => ({ file, id: makeFileId() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files]
  );

  // Reset internal state whenever a fresh batch of files arrives.
  const filesSignature = React.useMemo(
    () => entries.map((e) => `${e.id}:${e.file.name}:${e.file.size}`).join("|"),
    [entries]
  );
  const lastSigRef = React.useRef<string>("");
  React.useEffect(() => {
    if (filesSignature !== lastSigRef.current) {
      lastSigRef.current = filesSignature;
      // Signal any in-flight `start()` to bail out before we reset state.
      cancelRef.current = true;
      if (abortRef.current) abortRef.current.abort();
      setStates({});
      setCompletedCount(0);
      setErrorCount(0);
      startedRef.current = false;
      cancelRef.current = false;
    }
  }, [filesSignature]);

  const start = React.useCallback(async () => {
    const currentEntries = entries;
    if (currentEntries.length === 0) {
      onDoneRef.current();
      return;
    }
    setStates(() => {
      const next: Record<string, UploadState> = {};
      for (const e of currentEntries) next[e.id] = { status: "pending", progress: 0 };
      return next;
    });
    setCompletedCount(0);
    setErrorCount(0);

    let doneCount = 0;
    let errCount = 0;
    // Upload sequentially to keep quota checks accurate and avoid hammering.
    for (const entry of currentEntries) {
      // Bail out if the user cancelled or a new batch superseded this one.
      if (cancelRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        setStates((s) => ({ ...s, [entry.id]: { status: "uploading", progress: 0 } }));
        await api.uploadFiles([entry.file], parentId, (pct) => {
          setStates((s) => ({ ...s, [entry.id]: { status: "uploading", progress: pct } }));
        }, controller.signal);
        setStates((s) => ({ ...s, [entry.id]: { status: "done", progress: 100 } }));
        doneCount += 1;
        setCompletedCount(doneCount);
      } catch (err) {
        if (controller.signal.aborted) {
          // User cancelled — stop the whole batch, don't mark as error.
          return;
        }
        const msg = err instanceof Error ? err.message : "Ошибка загрузки";
        setStates((s) => ({ ...s, [entry.id]: { status: "error", progress: 0, error: msg } }));
        errCount += 1;
        setErrorCount(errCount);
        toast.error(`${entry.file.name}: ${msg}`);
      } finally {
        abortRef.current = null;
      }
    }

    if (doneCount > 0) {
      toast.success(`Загружено файлов: ${doneCount} из ${currentEntries.length}`);
    }

    // Auto-close the overlay shortly after a fully successful batch.
    if (errCount === 0 && doneCount === currentEntries.length) {
      setTimeout(() => {
        onDoneRef.current();
      }, 1200);
    }
  }, [entries, parentId]);

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
    onCancelRef.current();
  }, []);

  if (!uploadVisible || entries.length === 0) return null;

  const allDone = completedCount === entries.length && errorCount === 0;
  const anyError = errorCount > 0;
  const finished = completedCount + errorCount === entries.length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm animate-in slide-in-from-bottom-4">
      <Card className="border-primary/20 shadow-2xl shadow-primary/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
          <div className="flex items-center gap-2 min-w-0">
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
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
            {finished && (
              <Button size="sm" variant="ghost" onClick={onDone} className="h-7">
                {anyError ? "Закрыть" : "Готово"}
              </Button>
            )}
            {!finished && (
              <Button size="icon" variant="ghost" onClick={handleCancel} className="h-7 w-7" aria-label="Отменить">
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
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
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
                    <div className="relative h-1 rounded-full bg-emerald-500/20 mt-1.5 overflow-hidden">
                      <div className="absolute inset-0 bg-emerald-500/40 doma-glow-burst" />
                    </div>
                  )}
                  {st.status === "error" && (
                    <div className="text-[11px] text-destructive mt-0.5 truncate">{st.error}</div>
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
