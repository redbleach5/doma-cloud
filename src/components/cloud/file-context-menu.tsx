"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import {
  Eye,
  Share2,
  Pencil,
  Trash2,
  RotateCcw,
  Download,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  item: FileItem;
  x: number;
  y: number;
  view: "files" | "trash";
  onClose: () => void;
  onOpen: (item: FileItem) => void;
  onPreview: (item: FileItem) => void;
  onShare: (item: FileItem) => void;
  onRenamed: () => void;
  onTrashed: () => void;
  onRestored: () => void;
  onPurged: () => void;
}

/**
 * Positioned action menu for files — opened by right-click or long-press.
 * Uses a manual popover (not Radix ContextMenu) so clicks reliably reach
 * the action buttons.
 */
export function FileContextMenu(props: Props) {
  const {
    item, x, y, view, onClose, onOpen, onPreview, onShare,
    onRenamed, onTrashed, onRestored, onPurged,
  } = props;
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Keep onClose in a ref so the document listeners don't need to be
  // re-attached on every render (which could race with click events
  // and "eat" clicks on buttons that happened to fire right as the
  // menu was closing).
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Close on outside pointerdown, scroll, or Escape.
  // We use pointerdown (not click) so the menu closes before the click
  // reaches another button — but we ONLY close if the pointer is outside
  // the menu. The click on the other button still fires normally.
  React.useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = menuRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      // Defer the close to the next tick so the pointerdown doesn't
      // race with the subsequent click event on another button.
      // Without this, the menu unmounts synchronously and the click
      // target may be invalidated.
      requestAnimationFrame(() => onCloseRef.current());
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    const onScroll = () => {
      onCloseRef.current();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleRename = async () => {
    onClose();
    const name = window.prompt("Новое имя:", item.name);
    if (!name?.trim() || name === item.name) return;
    try {
      await api.rename(item.id, name.trim());
      toast.success("Переименовано");
      onRenamed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось переименовать");
    }
  };

  const handleTrash = async () => {
    onClose();
    try {
      await api.trash(item.id);
      toast.success("Перемещено в корзину");
      onTrashed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const handleRestore = async () => {
    onClose();
    try {
      await api.restore(item.id);
      toast.success("Восстановлено");
      onRestored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось восстановить");
    }
  };

  const handlePurge = async () => {
    onClose();
    if (!window.confirm(`Удалить навсегда: «${item.name}»? Это действие необратимо.`)) return;
    try {
      await api.purge(item.id);
      toast.success("Удалено навсегда");
      onPurged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const handleDownload = () => {
    onClose();
    const a = document.createElement("a");
    a.href = api.downloadUrl(item.id);
    a.download = item.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleCopyLink = async () => {
    onClose();
    try {
      const share = await api.createShare(item.id, {});
      const url = window.location.origin + share.url;
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось создать ссылку");
    }
  };

  const handleShare = () => {
    onClose();
    onShare(item);
  };

  const handleOpen = () => {
    onClose();
    if (item.isDirectory) onOpen(item);
    else onPreview(item);
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-1 shadow-xl animate-in fade-in-0 zoom-in-95"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 220)),
        top: Math.max(8, Math.min(y, window.innerHeight - 320)),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate border-b border-border/40 mb-1">
        {item.name}
      </div>
      {view === "files" && (
        <>
          <MenuItem onClick={handleOpen}>
            <Eye className="h-4 w-4 mr-2" />
            {item.isDirectory ? "Открыть" : "Просмотр"}
          </MenuItem>
          {!item.isDirectory && (
            <MenuItem onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Скачать
            </MenuItem>
          )}
          {!item.isDirectory && (
            <>
              <MenuItem onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Поделиться
              </MenuItem>
              <MenuItem onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />
                Копировать ссылку
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          <MenuItem onClick={handleRename}>
            <Pencil className="h-4 w-4 mr-2" />
            Переименовать
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={handleTrash} variant="destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            В корзину
          </MenuItem>
        </>
      )}
      {view === "trash" && (
        <>
          <MenuItem onClick={handleRestore}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Восстановить
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={handlePurge} variant="destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить навсегда
          </MenuItem>
        </>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center px-2.5 py-2 rounded-md text-sm transition-colors ${
        variant === "destructive"
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="h-px bg-border/40 my-1" />;
}
