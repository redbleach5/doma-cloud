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
  Scissors,
  ClipboardPaste,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import { promptDialog, confirmDialog } from "@/components/cloud/prompt-dialog";
import { shareOrCopyUrl } from "@/lib/cloud/share-url";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";

function useIsNarrow() {
  const [narrow, setNarrow] = React.useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 767px)").matches
      : true
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

interface Props {
  item: FileItem;
  x: number;
  y: number;
  view: "files" | "trash" | "shared";
  /** Permission for shared-folder view. undefined for owner view. */
  permission?: "view" | "upload" | "edit";
  /** SharedFolder.id when operating inside a shared folder. */
  sharedFolderId?: string;
  onClose: () => void;
  onOpen: (item: FileItem) => void;
  onPreview: (item: FileItem) => void;
  onShare: (item: FileItem) => void;
  onRenamed: () => void;
  onTrashed: () => void;
  onRestored: () => void;
  onPurged: () => void;
  onMove: (item: FileItem) => void;
  /** Enter multiselect with this item selected. */
  onSelect?: (item: FileItem) => void;
}

/**
 * Clipboard for cut/paste — module-level so it survives context menu
 * unmount between invocations. Holds a single FileItem reference plus
 * the ownerId it was cut from (defence-in-depth: paste refuses if the
 * current user doesn't own the source, though the API enforces this
 * anyway).
 */
let cutItem: FileItem | null = null;

/** Programmatically open the context menu for a different item (used by paste). */
export function pasteAvailable(): boolean {
  return cutItem !== null;
}

/**
 * Positioned action menu for files — opened by right-click or long-press.
 * Uses a manual popover (not Radix ContextMenu) so clicks reliably reach
 * the action buttons.
 *
 * Permission rules:
 *   - owner view (files/trash): everything applies as before.
 *   - shared view + view:    only Open, Download.
 *   - shared view + upload:  + Cut, Paste (for moving into subfolders).
 *   - shared view + edit:    + Rename, Trash, Move, Mkdir.
 *   - For folders in owner view: "Поделиться" opens the share dialog
 *     (creates a SharedFolder with another user). For files in owner
 *     view: "Поделиться" creates a public link-share.
 */
export function FileContextMenu(props: Props) {
  const {
    item, x, y, view, permission, sharedFolderId, onClose, onOpen, onPreview, onShare,
    onRenamed, onTrashed, onRestored, onPurged, onMove, onSelect,
  } = props;
  const menuRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const isNarrow = useIsNarrow();

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Desktop popover: outside click / escape / scroll. Mobile sheet uses Dialog.
  React.useEffect(() => {
    if (isNarrow) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = menuRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      requestAnimationFrame(() => onCloseRef.current());
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const el = menuRef.current;
        if (!el) return;
        const items = Array.from(
          el.querySelectorAll<HTMLElement>('button[role="menuitem"]')
        );
        if (items.length === 0) return;
        const current = document.activeElement as HTMLElement | null;
        const idx = current ? items.indexOf(current) : -1;
        let nextIdx: number;
        if (e.key === "ArrowDown") {
          nextIdx = idx < 0 || idx === items.length - 1 ? 0 : idx + 1;
        } else {
          nextIdx = idx <= 0 ? items.length - 1 : idx - 1;
        }
        items[nextIdx]?.focus();
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const el = menuRef.current;
        if (!el) return;
        const items = Array.from(
          el.querySelectorAll<HTMLElement>('button[role="menuitem"]')
        );
        if (items.length === 0) return;
        (e.key === "Home" ? items[0] : items[items.length - 1])?.focus();
        return;
      }
      if (e.key === "Tab") {
        onCloseRef.current();
      }
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
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        try { prev.focus(); } catch { /* element may be gone */ }
      }
    };
  }, [isNarrow]);

  React.useLayoutEffect(() => {
    if (isNarrow) return;
    const el = menuRef.current;
    if (!el) return;
    const firstItem = el.querySelector<HTMLElement>('button[role="menuitem"]');
    if (firstItem) {
      firstItem.focus();
    } else {
      el.focus();
    }
  }, [isNarrow]);

  const isShared = view === "shared";
  const canEdit = !isShared || permission === "edit";
  const canUpload = !isShared || permission === "upload" || permission === "edit";
  const canShare = !isShared;

  const handleRename = async () => {
    onClose();
    const name = await promptDialog({
      title: "Переименовать",
      description: "Введите новое имя для файла или папки.",
      label: "Новое имя",
      defaultValue: item.name,
      confirmText: "Переименовать",
      minLength: 1,
      maxLength: 255,
    });
    if (!name || name === item.name) return;
    try {
      await api.rename(item.id, name);
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
      const result = await api.restore(item.id);
      if (result.movedToRoot) {
        toast.success("Восстановлено в корень — родительская папка ещё в корзине");
      } else {
        toast.success("Восстановлено");
      }
      onRestored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось восстановить");
    }
  };

  const handlePurge = async () => {
    onClose();
    const ok = await confirmDialog({
      title: `Удалить навсегда: «${item.name}»?`,
      description: "Это действие необратимо — файл нельзя будет восстановить из корзины.",
      confirmText: "Удалить навсегда",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
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

  /**
   * "Копировать ссылку" — creates a link-share with sensible defaults
   * (7-day expiry, no password, no max-views) and copies the URL.
   *
   * Previously this created an UNEXPIRING public link silently. Now we
   * ask for confirmation first, and the link has a default expiry. The
   * user can still create unexpiring links via the full share dialog.
   *
   * Files only — for folders we redirect to the share dialog (which
   * supports folder sharing with another user account).
   */
  const handleCopyLink = async () => {
    onClose();
    if (item.isDirectory) {
      // Folders can't be link-shared — open the full dialog instead.
      onShare(item);
      return;
    }
    const ok = await confirmDialog({
      title: "Создать ссылку на файл?",
      description: "Будет одна публичная ссылка на 7 дней (без пароля). Если ссылка уже есть — обновим её параметры, адрес останется тем же.",
      confirmText: "Создать / обновить",
      cancelText: "Отмена",
    });
    if (!ok) return;
    try {
      const expiresAt = new Date(Date.now() + 7 * 86400_000);
      const share = await api.createShare(item.id, {
        expiresAt: expiresAt.toISOString(),
        label: "Быстрая ссылка",
      });
      const url = window.location.origin + share.url;
      const verb = share.updated ? "обновлена" : "создана";
      const result = await shareOrCopyUrl(url, item.name);
      if (result === "shared") {
        toast.success(`Ссылка ${verb}`, {
          description: "Действует 7 дней. Отозвать можно в «Поделиться».",
        });
      } else if (result === "copied") {
        toast.success(`Ссылка ${verb} и скопирована`, {
          description: "Действует 7 дней. Отозвать можно в «Поделиться».",
        });
      } else if (result === "cancelled") {
        toast.success(`Ссылка ${verb}`, {
          description: "Откройте «Поделиться», чтобы скопировать её снова.",
        });
      } else {
        toast.success(`Ссылка ${verb}`, {
          description: url,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
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

  const handleCut = () => {
    onClose();
    cutItem = item;
    toast.success(`«${item.name}» вырезан — выберите папку для вставки`);
  };

  const handlePasteHere = async () => {
    onClose();
    if (!cutItem) return;
    if (cutItem.id === item.id) {
      toast.error("Нельзя вставить папку саму в себя");
      return;
    }
    // If the target is a directory, paste INTO it. If it's a file,
    // paste into the current parent (sibling).
    const targetParent = item.isDirectory ? item.id : item.parentId;
    try {
      const result = await api.move(
        cutItem.id,
        targetParent,
        sharedFolderId ? { sharedFolderId } : undefined
      );
      if (result.moved) {
        toast.success(`«${cutItem.name}» перемещён`);
      } else {
        toast.info("Файл уже в этой папке");
      }
      cutItem = null;
      onRenamed(); // refresh list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось переместить");
    }
  };

  const handleMoveTo = () => {
    onClose();
    onMove(item);
  };

  const canPaste = cutItem !== null && cutItem.id !== item.id;

  React.useLayoutEffect(() => {
    if (isNarrow || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const overhangY = rect.bottom - (window.innerHeight - 8);
    if (overhangY > 0) {
      const newTop = Math.max(8, rect.top - overhangY - 8);
      menuRef.current.style.top = `${newTop}px`;
    }
    const overhangX = rect.right - (window.innerWidth - 8);
    if (overhangX > 0) {
      const newLeft = Math.max(8, rect.left - overhangX - 8);
      menuRef.current.style.left = `${newLeft}px`;
    }
  }, [x, y, isNarrow]);

  const menuItems = (
    <>
      {onSelect && (
        <>
          <MenuItem
            onClick={() => {
              onSelect(item);
              onClose();
            }}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Выбрать
          </MenuItem>
          <MenuSeparator />
        </>
      )}
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
          {canShare && (
            <>
              <MenuItem onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                {item.isDirectory ? "Поделиться папкой…" : "Поделиться…"}
              </MenuItem>
              <MenuItem onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />
                {item.isDirectory ? "Поделиться ссылкой…" : "Копировать ссылку"}
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          {canEdit && (
            <>
              <MenuItem onClick={handleCut}>
                <Scissors className="h-4 w-4 mr-2" />
                Вырезать
              </MenuItem>
              {canPaste && (
                <MenuItem onClick={handlePasteHere}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Вставить {item.isDirectory ? "в папку" : "сюда"}
                </MenuItem>
              )}
              <MenuItem onClick={handleMoveTo}>
                <FolderMoveIcon />
                Переместить в…
              </MenuItem>
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
          {!canEdit && canUpload && (
            <>
              <MenuItem onClick={handleCut}>
                <Scissors className="h-4 w-4 mr-2" />
                Вырезать
              </MenuItem>
              {canPaste && (
                <MenuItem onClick={handlePasteHere}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Вставить {item.isDirectory ? "в папку" : "сюда"}
                </MenuItem>
              )}
            </>
          )}
        </>
      )}
      {view === "shared" && (
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
          {canEdit && (
            <>
              <MenuSeparator />
              <MenuItem onClick={handleCut}>
                <Scissors className="h-4 w-4 mr-2" />
                Вырезать
              </MenuItem>
              {canPaste && (
                <MenuItem onClick={handlePasteHere}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Вставить {item.isDirectory ? "в папку" : "сюда"}
                </MenuItem>
              )}
              <MenuItem onClick={handleMoveTo}>
                <FolderMoveIcon />
                Переместить в…
              </MenuItem>
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
          {canUpload && !canEdit && (
            <>
              <MenuSeparator />
              <MenuItem onClick={handleCut}>
                <Scissors className="h-4 w-4 mr-2" />
                Вырезать
              </MenuItem>
              {canPaste && (
                <MenuItem onClick={handlePasteHere}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Вставить {item.isDirectory ? "в папку" : "сюда"}
                </MenuItem>
              )}
            </>
          )}
          {!canUpload && !canEdit && (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
              Только просмотр — у вас нет прав на изменение этого файла.
            </div>
          )}
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
    </>
  );

  if (isNarrow) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle className="truncate pr-2" title={item.name}>
              {item.name}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-0.5 pb-3 -mx-1">
            {menuItems}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={`Меню действий для «${item.name}»`}
      className="fixed z-50 min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-1 shadow-xl animate-in fade-in-0 zoom-in-95 outline-hidden"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 240)),
        top: Math.max(8, Math.min(y, window.innerHeight - 360)),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate border-b border-border/40 mb-1">
        {item.name}
      </div>
      {menuItems}
    </div>
  );
}

function FolderMoveIcon() {
  return (
    <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v5M9.5 13.5 12 11l2.5 2.5" />
    </svg>
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
      tabIndex={-1}
      onClick={onClick}
      className={`w-full flex items-center px-2.5 py-2.5 min-h-11 rounded-md text-sm transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover ${
        variant === "destructive"
          ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
          : "hover:bg-accent focus-visible:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="h-px bg-border/40 my-1" />;
}
