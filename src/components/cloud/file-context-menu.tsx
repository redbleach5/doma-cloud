"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
 * Adaptive context menu: uses Radix ContextMenu on desktop (right-click) and
 * a positioned popover on touch devices (long-press).
 *
 * We always render the Radix ContextMenu so right-click works everywhere.
 * For long-press, we additionally render a manual popover anchored at the
 * provided {x, y} coordinates.
 */
export function FileContextMenu(props: Props) {
  const { item, x, y, view, onClose, onOpen, onPreview, onShare, onRenamed, onTrashed, onRestored, onPurged } = props;
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);

  // Detect if this was triggered by touch (long-press) — show manual popover.
  // We use a small delay to let Radix try its native ContextMenu first on
  // desktop right-click; if a contextmenu event fires in that window, we
  // assume Radix handled it and don't show the manual popover (otherwise
  // both menus would appear simultaneously on desktop).
  React.useEffect(() => {
    let cancelled = false;
    const onNativeContextMenu = () => {
      cancelled = true;
    };
    window.addEventListener("contextmenu", onNativeContextMenu, { once: true });
    const timer = setTimeout(() => {
      window.removeEventListener("contextmenu", onNativeContextMenu);
      if (!cancelled) setMenuPos({ x, y });
    }, 80);
    return () => {
      window.removeEventListener("contextmenu", onNativeContextMenu);
      clearTimeout(timer);
    };
  }, [x, y]);

  // Close popover on outside click / scroll / Esc.
  React.useEffect(() => {
    if (!menuPos) return;
    const close = () => {
      setMenuPos(null);
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    const escHandler = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", escHandler);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", escHandler);
    };
  }, [menuPos, onClose]);

  const handleRename = async () => {
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
    try {
      await api.trash(item.id);
      toast.success("Перемещено в корзину");
      onTrashed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const handleRestore = async () => {
    try {
      await api.restore(item.id);
      toast.success("Восстановлено");
      onRestored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось восстановить");
    }
  };

  const handlePurge = async () => {
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
    const a = document.createElement("a");
    a.href = api.downloadUrl(item.id);
    a.download = item.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleCopyLink = async () => {
    try {
      const share = await api.createShare(item.id, {});
      const url = window.location.origin + share.url;
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось создать ссылку");
    }
  };

  const menuItems = (
    <>
      {view === "files" && (
        <>
          <ContextMenuItem onClick={() => (item.isDirectory ? onOpen(item) : onPreview(item))}>
            <Eye className="h-4 w-4 mr-2" />
            {item.isDirectory ? "Открыть" : "Просмотр"}
          </ContextMenuItem>
          {!item.isDirectory && (
            <ContextMenuItem onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Скачать
            </ContextMenuItem>
          )}
          {!item.isDirectory && (
            <>
              <ContextMenuItem onClick={() => onShare(item)}>
                <Share2 className="h-4 w-4 mr-2" />
                Поделиться
              </ContextMenuItem>
              <ContextMenuItem onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />
                Копировать ссылку
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleRename}>
            <Pencil className="h-4 w-4 mr-2" />
            Переименовать
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleTrash} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            В корзину
          </ContextMenuItem>
        </>
      )}
      {view === "trash" && (
        <>
          <ContextMenuItem onClick={handleRestore}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Восстановить
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handlePurge} className="text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить навсегда
          </ContextMenuItem>
        </>
      )}
    </>
  );

  return (
    <>
      {/* Hidden Radix ContextMenu — captures right-click globally on the trigger area.
          We render it with an empty trigger so right-click anywhere still works
          via the parent's onContextMenu handler. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="fixed inset-0 -z-10" aria-hidden />
        </ContextMenuTrigger>
        <ContextMenuContent>{menuItems}</ContextMenuContent>
      </ContextMenu>

      {/* Manual popover for long-press */}
      {menuPos && (
        <div
          className="fixed z-50 min-w-48 rounded-lg border border-border bg-popover p-1 shadow-xl animate-in fade-in-0 zoom-in-95"
          style={{
            left: Math.min(menuPos.x, window.innerWidth - 220),
            top: Math.min(menuPos.y, window.innerHeight - 280),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate border-b border-border/40 mb-1">
            {item.name}
          </div>
          {view === "files" && (
            <>
              <PopoverItem onClick={() => (item.isDirectory ? onOpen(item) : onPreview(item))}>
                <Eye className="h-4 w-4 mr-2" />
                {item.isDirectory ? "Открыть" : "Просмотр"}
              </PopoverItem>
              {!item.isDirectory && (
                <PopoverItem onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Скачать
                </PopoverItem>
              )}
              {!item.isDirectory && (
                <>
                  <PopoverItem onClick={() => onShare(item)}>
                    <Share2 className="h-4 w-4 mr-2" />
                    Поделиться
                  </PopoverItem>
                  <PopoverItem onClick={handleCopyLink}>
                    <Copy className="h-4 w-4 mr-2" />
                    Копировать ссылку
                  </PopoverItem>
                </>
              )}
              <PopoverSeparator />
              <PopoverItem onClick={handleRename}>
                <Pencil className="h-4 w-4 mr-2" />
                Переименовать
              </PopoverItem>
              <PopoverSeparator />
              <PopoverItem onClick={handleTrash} variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                В корзину
              </PopoverItem>
            </>
          )}
          {view === "trash" && (
            <>
              <PopoverItem onClick={handleRestore}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Восстановить
              </PopoverItem>
              <PopoverSeparator />
              <PopoverItem onClick={handlePurge} variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Удалить навсегда
              </PopoverItem>
            </>
          )}
        </div>
      )}
    </>
  );
}

function PopoverItem({
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

function PopoverSeparator() {
  return <div className="h-px bg-border/40 my-1" />;
}
