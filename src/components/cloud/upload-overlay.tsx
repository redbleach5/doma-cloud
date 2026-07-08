"use client";

import * as React from "react";
import { api } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, X, UploadCloud, AlertCircle } from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { cn } from "@/lib/utils";
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

export function UploadOverlay({ files, parentId, onDone, onCancel }: Props) {
  const { uploadVisible, setUploadVisible } = useCloudStore();
  const [states, setStates] = React.useState<Record<string, UploadState>>({});
  const [completedCount, setCompletedCount] = React.useState(0);
  const startedRef = React.useRef(false);

  const start = React.useCallback(async () => {
    if (files.length === 0) {
      onDone();
      return;
    }
    setStates((s) => {
      const next = { ...s };
      for (const f of files) next[f.name + f.size] = { status: "pending", progress: 0 };
      return next;
    });

    let doneCount = 0;
    // Upload sequentially to keep quota checks accurate and avoid hammering.
    for (const file of files) {
      const key = file.name + file.size;
      setStates((s) => ({ ...s, [key]: { status: "uploading", progress: 0 } }));
      try {
        await api.uploadFiles([file], parentId, (pct) => {
          setStates((s) => ({ ...s, [key]: { status: "uploading", progress: pct } }));
        });
        setStates((s) => ({ ...s, [key]: { status: "done", progress: 100 } }));
        doneCount += 1;
        setCompletedCount(doneCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ошибка загрузки";
        setStates((s) => ({ ...s, [key]: { status: "error", progress: 0, error: msg } }));
        toast.error(`${file.name}: ${msg}`);
      }
    }

    if (doneCount > 0) {
      toast.success(`Загружено файлов: ${doneCount} из ${files.length}`);
    }
  }, [files, parentId, onDone]);

  React.useEffect(() => {
    if (uploadVisible && files.length > 0 && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    if (!uploadVisible) startedRef.current = false;
  }, [uploadVisible, files, start]);

  if (!uploadVisible || files.length === 0) return null;

  const allDone = completedCount === files.length;
  const anyError = Object.values(states).some((s) => s.status === "error");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm animate-in slide-in-from-bottom-4">
      <Card className="border-primary/20 shadow-2xl shadow-primary/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
          <div className="flex items-center gap-2">
            {allDone ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : anyError ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            )}
            <div>
              <div className="text-sm font-medium">
                {allDone ? "Загрузка завершена" : "Загружаем файлы"}
              </div>
              <div className="text-xs text-muted-foreground">
                {completedCount} / {files.length}
                {!allDone && files.length > 0 && (
                  <> · {formatBytes(files.reduce((s, f) => s + f.size, 0))}</>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {allDone && (
              <Button size="sm" variant="ghost" onClick={onDone} className="h-7">
                Готово
              </Button>
            )}
            {!allDone && (
              <Button size="icon" variant="ghost" onClick={onCancel} className="h-7 w-7" aria-label="Скрыть">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {files.map((f) => {
            const key = f.name + f.size;
            const st = states[key] ?? { status: "pending", progress: 0 };
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0">
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
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground shrink-0">
                      {formatBytes(f.size)}
                    </div>
                  </div>
                  {st.status === "uploading" && (
                    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden mt-1.5">
                      <div
                        className="relative h-full rounded-full transition-all duration-300 doma-flame-bar"
                        style={{ width: `${st.progress}%` }}
                      >
                        {/* Flame tongue at the leading edge — flickers */}
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
