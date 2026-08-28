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
import type { FileViewSelectionProps } from "@/components/cloud/file-grid";

interface Props extends FileViewSelectionProps {
  items: FileItem[];
  view: "files" | "trash" | "shared";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

const ROW_HEIGHT = 52;

export function FileList({
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
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const last = virtualRows[virtualRows.length - 1];

  React.useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) return;
    if (!last) return;
    if (last.index >= items.length - 8) onLoadMore();
  }, [last, items.length, hasMore, onLoadMore, isFetchingMore]);

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden bg-card">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border/40 bg-muted/30">
        <div>Имя</div>
        <div className="hidden sm:block text-right">Изменён</div>
        <div className="text-right">Размер</div>
      </div>
      <div
        className="relative w-full divide-y divide-border/30"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((vRow) => {
          const item = items[vRow.index]!;
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${vRow.start}px)` }}
            >
              <FileRow
                item={item}
                view={view}
                selected={selectedIds.has(item.id)}
                selectionMode={selectionMode}
                onOpen={onItemOpen}
                onToggle={onItemToggle}
                onContext={onItemContext}
                onLongPress={onItemLongPress}
              />
            </div>
          );
        })}
      </div>
      {isFetchingMore && (
        <div className="py-3 text-center text-xs text-muted-foreground border-t border-border/30">
          Загрузка…
        </div>
      )}
    </div>
  );
}

function FileRow({
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
        "group w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 items-center px-4 py-2.5 min-h-11 text-left hover:bg-accent/40 transition-colors doma-warm-glow relative",
        "focus-visible:outline-hidden focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        longPress.highlight && "bg-accent/60 ring-2 ring-inset ring-primary/40",
        selected && "bg-primary/5 ring-2 ring-inset ring-primary/40"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
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
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-opacity",
            showCheckbox
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            selected
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-muted/40 border-border/60 text-transparent hover:border-primary/50"
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
        <div
          className={cn(
            "h-9 w-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden transition-transform duration-500",
            breathing && "scale-105"
          )}
        >
          {item.isDirectory ? (
            <FolderStack hovered={breathing} className="w-full h-full" />
          ) : (
            <FileThumb
              item={item}
              size={64}
              enabled={showThumb}
              imgClassName="h-full w-full object-cover"
              iconClassName="h-5 w-5 text-muted-foreground"
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-sm font-medium truncate" title={item.name}>
              {item.name}
            </div>
            {item.isShared && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary shrink-0"
                title={permTitle}
              >
                <Users className="h-2.5 w-2.5" />
                {item.permission && <span>{permLabelShort(item.permission)}</span>}
              </span>
            )}
          </div>
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
