"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileItem } from "@/lib/cloud/api";
import { formatBytes, formatRelative } from "@/lib/cloud/format";
import { permLabel, permLabelShort } from "@/lib/cloud/permissions";
import { FileThumb } from "@/components/cloud/file-thumb";
import { FolderStack } from "@/components/cloud/decor/folder-stack";
import { useLongPress } from "@/components/cloud/use-long-press";
import { cn } from "@/lib/utils";
import { Check, Users } from "lucide-react";

export interface FileViewSelectionProps {
  selectedIds: Set<string>;
  /** When true, checkboxes are always visible (select session). */
  selectionMode: boolean;
  onItemOpen: (item: FileItem, e: React.MouseEvent) => void;
  onItemToggle: (item: FileItem, e: React.MouseEvent) => void;
  onItemContext: (e: React.MouseEvent, item: FileItem) => void;
  onItemLongPress: (item: FileItem, coords: { x: number; y: number }) => void;
}

interface Props extends FileViewSelectionProps {
  items: FileItem[];
  view: "files" | "trash" | "shared";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

function useGridColumns(width: number): number {
  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
}

export function FileGrid({
  items,
  view,
  scrollRef,
  hasMore,
  isFetchingMore,
  onLoadMore,
  selectedIds,
  selectionMode,
  onItemOpen,
  onItemToggle,
  onItemContext,
  onItemLongPress,
}: Props) {
  const measureRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(800);

  React.useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);

  const cols = useGridColumns(width);
  const rowCount = Math.ceil(items.length / cols) || 0;
  const estimateRow = Math.max(160, Math.floor((width - (cols - 1) * 12) / cols) + 56);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRow,
    overscan: 4,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows[virtualRows.length - 1];

  React.useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) return;
    if (!lastRow) return;
    if (lastRow.index >= rowCount - 3) onLoadMore();
  }, [lastRow, rowCount, hasMore, onLoadMore, isFetchingMore]);

  return (
    <div ref={measureRef}>
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((vRow) => {
          const start = vRow.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full grid gap-3"
              style={{
                transform: `translateY(${vRow.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {rowItems.map((item) => (
                <FileCard
                  key={item.id}
                  item={item}
                  view={view}
                  selected={selectedIds.has(item.id)}
                  selectionMode={selectionMode}
                  onOpen={onItemOpen}
                  onToggle={onItemToggle}
                  onContext={onItemContext}
                  onLongPress={onItemLongPress}
                />
              ))}
            </div>
          );
        })}
      </div>
      {isFetchingMore && (
        <div className="py-4 text-center text-xs text-muted-foreground">Загрузка…</div>
      )}
    </div>
  );
}

function FileCard({
  item,
  view,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  onContext,
  onLongPress,
}: {
  item: FileItem;
  view: "files" | "trash" | "shared";
  selected: boolean;
  selectionMode: boolean;
  onOpen: (item: FileItem, e: React.MouseEvent) => void;
  onToggle: (item: FileItem, e: React.MouseEvent) => void;
  onContext: (e: React.MouseEvent, item: FileItem) => void;
  onLongPress: (item: FileItem, coords: { x: number; y: number }) => void;
}) {
  const [breathing, setBreathing] = React.useState(false);
  const longPress = useLongPress(
    React.useCallback(
      (coords) => onLongPress(item, coords),
      [item, onLongPress]
    )
  );

  const handleClick = (e: React.MouseEvent) => {
    if (longPress.consumeIfFired()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      onToggle(item, e);
      return;
    }
    onOpen(item, e);
  };

  const showThumb = !item.isDirectory && (view === "files" || view === "shared");

  const permTitle = item.permission
    ? `Общий доступ · ${permLabel(item.permission)}`
    : "Общий доступ";

  const showCheckbox = selectionMode || selected;

  return (
    <button
      type="button"
      data-file-item={item.id}
      onClick={handleClick}
      onContextMenu={(e) => onContext(e, item)}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onMouseEnter={() => setBreathing(true)}
      onMouseLeave={() => setBreathing(false)}
      data-long-pressable
      aria-label={`${item.isDirectory ? "Папка" : "Файл"}: ${item.name}${item.isDirectory ? "" : ", " + formatBytes(item.sizeBytes)}`}
      className={cn(
        "group relative flex flex-col items-center text-center p-3 rounded-xl border border-border/40 bg-card doma-warm-glow",
        "hover:bg-accent/40 hover:border-primary/20 transition-all",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40",
        breathing && "doma-breathe",
        longPress.highlight && "ring-2 ring-primary/50 bg-accent/50",
        selected && "ring-2 ring-primary/60 border-primary/40 bg-primary/5"
      )}
    >
      <span
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? `Снять «${item.name}»` : `Выбрать «${item.name}»`}
        tabIndex={-1}
        data-testid={`select-${item.id}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(item, e);
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            onToggle(item, e as unknown as React.MouseEvent);
          }
        }}
        className={cn(
          "absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-opacity",
          showCheckbox
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          selected
            ? "bg-primary border-primary text-primary-foreground"
            : "bg-background/90 border-border/60 text-transparent hover:border-primary/50"
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
      <div className="aspect-square w-full mb-2 rounded-lg overflow-hidden flex items-center justify-center bg-muted/40 relative">
        {item.isDirectory ? (
          <FolderStack hovered={breathing} />
        ) : (
          <FileThumb
            item={item}
            size={256}
            enabled={showThumb}
            alt={item.name}
            imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            iconClassName={cn("h-12 w-12 transition-transform duration-500 group-hover:scale-110")}
          />
        )}
        {item.isShared && (
          <div
            className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-background/85 backdrop-blur px-1.5 py-0.5 text-[11px] font-medium text-primary shadow-sm max-w-[calc(100%-0.75rem)]"
            title={permTitle}
          >
            <Users className="h-2.5 w-2.5 shrink-0" />
            {item.permission && (
              <span className="truncate">{permLabelShort(item.permission)}</span>
            )}
          </div>
        )}
      </div>
      <div className="w-full">
        <div className="text-xs font-medium truncate" title={item.name}>
          {item.name}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {item.isDirectory ? "—" : formatBytes(item.sizeBytes)}
        </div>
        {view === "trash" && item.deletedAt && (
          <div className="text-[11px] text-destructive mt-0.5">
            удалено {formatRelative(item.deletedAt)}
          </div>
        )}
      </div>
    </button>
  );
}
