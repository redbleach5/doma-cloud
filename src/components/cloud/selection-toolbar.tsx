"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  CheckSquare,
  Download,
  FolderInput,
  Loader2,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectionToolbarProps {
  count: number;
  totalVisible: number;
  view: "files" | "trash" | "shared";
  busy?: boolean;
  hasMorePages?: boolean;
  canTrash?: boolean;
  canMove?: boolean;
  canRestore?: boolean;
  canPurge?: boolean;
  canDownload?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onTrash?: () => void;
  onMove?: () => void;
  onRestore?: () => void;
  onPurge?: () => void;
  onDownload?: () => void;
  className?: string;
}

/**
 * Sticky bulk-action strip for select session / non-empty selection.
 */
export function SelectionToolbar({
  count,
  totalVisible,
  view,
  busy,
  hasMorePages,
  canTrash,
  canMove,
  canRestore,
  canPurge,
  canDownload,
  onSelectAll,
  onClear,
  onTrash,
  onMove,
  onRestore,
  onPurge,
  onDownload,
  className,
}: SelectionToolbarProps) {
  const allSelected = count > 0 && count >= totalVisible && totalVisible > 0;
  const emptyHint = count === 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 border-b border-primary/20 bg-primary/5",
        className
      )}
      role="toolbar"
      aria-label="Действия с выбранными"
      data-testid="selection-toolbar"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5 shrink-0"
        onClick={allSelected ? onClear : onSelectAll}
        disabled={busy || totalVisible === 0}
        title={
          allSelected
            ? "Снять выделение"
            : hasMorePages
              ? "Выбрать все загруженные на экране (не всю папку)"
              : "Выбрать все на экране"
        }
      >
        {allSelected ? (
          <CheckSquare className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4" />
        )}
        <span className="text-sm font-medium tabular-nums">
          {emptyHint ? (
            <span className="font-normal text-muted-foreground">Отметьте объекты</span>
          ) : (
            <>
              {count}
              <span className="hidden sm:inline font-normal text-muted-foreground">
                {" "}
                выбрано
                {hasMorePages ? " · на экране" : ""}
              </span>
            </>
          )}
        </span>
      </Button>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        {!emptyHint && view === "trash" && (
          <>
            {canRestore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onRestore}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Восстановить</span>
              </Button>
            )}
            {canPurge && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-destructive hover:bg-destructive/10"
                onClick={onPurge}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Удалить</span>
              </Button>
            )}
          </>
        )}
        {!emptyHint && view !== "trash" && (
          <>
            {canDownload && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onDownload}
                disabled={busy}
                title="Скачать файлы (папки не входят)"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Скачать</span>
              </Button>
            )}
            {canMove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onMove}
                disabled={busy}
              >
                <FolderInput className="h-4 w-4" />
                <span className="hidden sm:inline">Переместить</span>
              </Button>
            )}
            {canTrash && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-destructive hover:bg-destructive/10"
                onClick={onTrash}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">В корзину</span>
              </Button>
            )}
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
          onClick={onClear}
          disabled={busy}
          aria-label="Снять выделение"
          title="Готово (Esc)"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
