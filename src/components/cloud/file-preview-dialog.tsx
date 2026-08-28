"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Share2, X, ChevronLeft, ChevronRight } from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { FilePreviewBody } from "@/components/cloud/file-preview-body";

interface Props {
  item: FileItem;
  onClose: () => void;
  onShare: (item: FileItem) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function FilePreviewDialog({ item, onClose, onShare, onPrev, onNext }: Props) {
  const url = api.downloadUrl(item.id);

  // Keep callbacks in refs so the listeners don't need re-attaching.
  const onPrevRef = React.useRef(onPrev);
  const onNextRef = React.useRef(onNext);
  React.useEffect(() => {
    onPrevRef.current = onPrev;
    onNextRef.current = onNext;
  }, [onPrev, onNext]);

  // Keyboard navigation — ArrowLeft / ArrowRight to flip through files.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && onPrevRef.current) onPrevRef.current();
      else if (e.key === "ArrowRight" && onNextRef.current) onNextRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Touch swipe navigation — mobile-only (the buttons are hidden on mobile).
  // The previous implementation hid the prev/next buttons on small screens
  // with a "use swipe" comment but never wired up swipe handling.
  const touchStartRef = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const onBodyTouchStart = React.useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const onBodyTouchEnd = React.useCallback((e: React.TouchEvent) => {
    const start = touchStartRef.current;
    if (!start) return;
    touchStartRef.current = null;
    const end = e.changedTouches[0];
    if (!end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    const dt = Date.now() - start.t;
    if (dt > 300) return;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy) * 2) return;
    if (dx > 0 && onPrevRef.current) onPrevRef.current();
    else if (dx < 0 && onNextRef.current) onNextRef.current();
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        sheetHint={false}
        className="inset-0 max-h-none h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 pb-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[90vh] sm:w-[95vw] sm:max-w-6xl sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border overflow-hidden flex flex-col data-[state=closed]:slide-out-to-bottom-0 data-[state=open]:slide-in-from-bottom-0"
      >
        <DialogHeader className="px-4 py-3 border-b border-border/60 flex-row items-center justify-between space-y-0 pt-[max(0.75rem,env(safe-area-inset-top))]" data-testid="file-preview-dialog">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base truncate" title={item.name}>
              {item.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {formatBytes(item.sizeBytes)} · {item.mimeType}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onPrev && (
              <Button variant="ghost" size="icon" onClick={onPrev} className="inline-flex h-9 w-9" aria-label="Предыдущий файл" title="← Предыдущий">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {onNext && (
              <Button variant="ghost" size="icon" onClick={onNext} className="inline-flex h-9 w-9" aria-label="Следующий файл" title="Следующий →">
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onShare(item)} className="gap-1.5 h-9">
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Поделиться</span>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5 h-9">
              <a href={url} download={item.name}>
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Скачать</span>
              </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9" aria-label="Закрыть" title="Esc">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div
          className="flex-1 overflow-hidden bg-muted/30 flex items-center justify-center pb-[env(safe-area-inset-bottom)]"
          onTouchStart={onBodyTouchStart}
          onTouchEnd={onBodyTouchEnd}
        >
          <FilePreviewBody item={item} url={url} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
