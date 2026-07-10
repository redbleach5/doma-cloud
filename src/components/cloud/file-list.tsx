"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { formatBytes, formatRelative } from "@/lib/cloud/format";
import { FileIcon } from "@/components/cloud/file-icon";
import { FolderStack } from "@/components/cloud/atmosphere/folder-stack";
import { cn } from "@/lib/utils";

interface Props {
  items: FileItem[];
  view: "files" | "trash";
  onOpen: (item: FileItem) => void;
  onContext: (e: React.MouseEvent, item: FileItem) => void;
  onLongPress: (item: FileItem, e: React.TouchEvent) => void;
}

export function FileList({ items, view, onOpen, onContext, onLongPress }: Props) {
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden bg-card">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border/40 bg-muted/30">
        <div>Имя</div>
        <div className="hidden sm:block text-right">Изменён</div>
        <div className="text-right">Размер</div>
      </div>
      <div className="divide-y divide-border/30">
        {items.map((item) => (
          <FileRow
            key={item.id}
            item={item}
            view={view}
            onOpen={onOpen}
            onContext={onContext}
            onLongPress={onLongPress}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({ item, view, onOpen, onContext, onLongPress }: Omit<Props, "items"> & { item: FileItem }) {
  const longPressTimer = React.useRef<number | null>(null);
  const longPressFiredRef = React.useRef(false);
  const [breathing, setBreathing] = React.useState(false);

  const startLongPress = (e: React.TouchEvent) => {
    if (view === "files") {
      longPressFiredRef.current = false;
      longPressTimer.current = window.setTimeout(() => {
        longPressFiredRef.current = true;
        onLongPress(item, e);
      }, 500);
    }
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // If a long-press fired, suppress the subsequent synthetic click so
  // we don't navigate into a folder the user just long-pressed.
  const handleClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onOpen(item);
  };

  const isImage = item.category === "image";
  const thumbUrl = isImage && view === "files" ? `/api/files/download/${item.id}` : null;

  return (
    <button
      onClick={handleClick}
      onContextMenu={(e) => onContext(e, item)}
      onTouchStart={startLongPress}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseEnter={() => setBreathing(true)}
      onMouseLeave={() => setBreathing(false)}
      data-long-pressable
      className={cn(
        "w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 items-center px-4 py-2.5 text-left hover:bg-accent/40 transition-colors doma-warm-glow",
        "focus-visible:outline-none focus-visible:bg-accent/60",
        breathing && "doma-breathe"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "h-9 w-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden transition-transform duration-500",
          breathing && "scale-110"
        )}>
          {item.isDirectory ? (
            <FolderStack hovered={breathing} className="w-full h-full" />
          ) : thumbUrl ? (
            <img src={thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <FileIcon item={item} className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={item.name}>{item.name}</div>
          {view === "trash" && item.deletedAt && (
            <div className="text-[11px] text-destructive">
              удалено {formatRelative(item.deletedAt)}
            </div>
          )}
        </div>
      </div>
      <div className="hidden sm:block text-xs text-muted-foreground text-right">
        {formatRelative(item.updatedAt)}
      </div>
      <div className="text-xs text-muted-foreground text-right tabular-nums">
        {item.isDirectory ? "—" : formatBytes(item.sizeBytes)}
      </div>
    </button>
  );
}
