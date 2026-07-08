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
import { Download, Share2, X } from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { FilePreviewBody } from "@/components/cloud/file-preview-body";

interface Props {
  item: FileItem;
  onClose: () => void;
  onShare: (item: FileItem) => void;
  onDeleted: () => void;
}

export function FilePreviewDialog({ item, onClose, onShare }: Props) {
  const url = api.downloadUrl(item.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/60 flex-row items-center justify-between space-y-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base truncate" title={item.name}>
              {item.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {formatBytes(item.sizeBytes)} · {item.mimeType}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => onShare(item)} className="gap-1.5">
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Поделиться</span>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <a href={url} download={item.name}>
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Скачать</span>
              </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden bg-muted/30 flex items-center justify-center">
          <FilePreviewBody item={item} url={url} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
