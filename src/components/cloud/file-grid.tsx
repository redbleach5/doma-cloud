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

export function FileGrid({ items, view, onOpen, onContext, onLongPress }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((item) => (
        <FileCard
          key={item.id}
          item={item}
          view={view}
          onOpen={onOpen}
          onContext={onContext}
          onLongPress={onLongPress}
        />
      ))}
    </div>
  );
}

function FileCard({ item, view, onOpen, onContext, onLongPress }: Omit<Props, "items"> & { item: FileItem }) {
  const longPressTimer = React.useRef<number | null>(null);
  const [breathing, setBreathing] = React.useState(false);

  const startLongPress = (e: React.TouchEvent) => {
    if (view === "files") {
      longPressTimer.current = window.setTimeout(() => onLongPress(item, e), 500);
    }
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const isImage = item.category === "image";
  const thumbUrl = isImage && view === "files" ? `/api/files/download/${item.id}` : null;

  return (
    <button
      onClick={() => onOpen(item)}
      onContextMenu={(e) => onContext(e, item)}
      onTouchStart={startLongPress}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseEnter={() => setBreathing(true)}
      onMouseLeave={() => setBreathing(false)}
      data-long-pressable
      className={cn(
        "group relative flex flex-col items-center text-center p-3 rounded-xl border border-border/40 bg-card doma-warm-glow",
        "hover:bg-accent/40 hover:border-primary/20 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        breathing && "doma-breathe"
      )}
    >
      <div className="aspect-square w-full mb-2 rounded-lg overflow-hidden flex items-center justify-center bg-muted/40 relative">
        {item.isDirectory ? (
          <FolderStack hovered={breathing} />
        ) : thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <FileIcon item={item} className={cn("h-12 w-12 transition-transform duration-500 group-hover:scale-110")} />
        )}
      </div>
      <div className="w-full">
        <div className="text-xs font-medium truncate" title={item.name}>
          {item.name}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {item.isDirectory ? "—" : formatBytes(item.sizeBytes)}
        </div>
        {view === "trash" && item.deletedAt && (
          <div className="text-[10px] text-destructive mt-0.5">
            удалено {formatRelative(item.deletedAt)}
          </div>
        )}
      </div>
    </button>
  );
}
