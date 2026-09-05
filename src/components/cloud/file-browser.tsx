"use client";

import * as React from "react";
import { api, type CurrentUser, type FileItem } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { CloudHeader } from "@/components/cloud/cloud-header";
import { CloudSidebar } from "@/components/cloud/cloud-sidebar";
import { Breadcrumbs } from "@/components/cloud/breadcrumbs";
import { FileGrid, gridColumnsFor } from "@/components/cloud/file-grid";
import { FileList } from "@/components/cloud/file-list";
import { UploadDropzone } from "@/components/cloud/upload-dropzone";
import { UploadOverlay, fileResumeKey } from "@/components/cloud/upload-overlay";
import {
  listPendingUploads,
  deletePendingUploads,
  blobToFile,
  type PendingUploadRecord,
} from "@/lib/cloud/upload-resume-db";
import { RotateCcw, Trash2, FolderPlus, Upload, Loader2, CheckSquare } from "lucide-react";
import { FileContextMenu } from "@/components/cloud/file-context-menu";
import { FilePreviewDialog } from "@/components/cloud/file-preview-dialog";
import { ShareDialog } from "@/components/cloud/share-dialog";
import { EmptyState } from "@/components/cloud/empty-state";
import { DropGlow, fireDropGlow } from "@/components/cloud/decor/drop-glow";
import { SettingsView } from "@/components/cloud/settings-view";
import { AdminView } from "@/components/cloud/admin-view";
import { MySharesView } from "@/components/cloud/my-shares-view";
import { MoveDialog } from "@/components/cloud/move-dialog";
import { SelectionToolbar } from "@/components/cloud/selection-toolbar";
import { MobileBottomNav } from "@/components/cloud/mobile-bottom-nav";
import { FileGridSkeleton, FileListSkeleton } from "@/components/cloud/file-skeletons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/cloud/plural";
import { toastBulkResult } from "@/lib/cloud/bulk";
import { PERM_LABEL, PERM_DESCRIPTION } from "@/lib/cloud/permissions";
import { promptDialog, confirmDialog } from "@/components/cloud/prompt-dialog";

interface Props {
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated?: (user: CurrentUser) => void;
}

export function FileBrowser({ user, onLogout, onUserUpdated }: Props) {
  const qc = useQueryClient();
  // Individual selectors — see cloud-sidebar.tsx for why this matters
  // in zustand v5 (stale closure avoidance).
  const view = useCloudStore((s) => s.view);
  const layout = useCloudStore((s) => s.layout);
  const path = useCloudStore((s) => s.path);
  const setUploadVisible = useCloudStore((s) => s.setUploadVisible);
  const pendingPreview = useCloudStore((s) => s.pendingPreview);
  const setPendingPreview = useCloudStore((s) => s.setPendingPreview);
  const pushFolder = useCloudStore((s) => s.pushFolder);
  const pushSharedFolder = useCloudStore((s) => s.pushSharedFolder);
  const currentFolderId = path[path.length - 1]?.id ?? null;
  const currentSharedFolderId = path[0]?.sharedFolderId;
  const currentPermission = path[0]?.permission;
  const isInsideShared = view === "shared" && !!currentSharedFolderId;

  // File input ref for "Upload" button.
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [resumeByFileKey, setResumeByFileKey] = React.useState<
    Record<
      string,
      { uploadId: string; parentId: string | null; sharedFolderId: string | null }
    > | undefined
  >(undefined);
  const [resumeBanner, setResumeBanner] = React.useState<PendingUploadRecord[] | null>(null);
  const [previewItem, setPreviewItem] = React.useState<FileItem | null>(null);
  const [shareItem, setShareItem] = React.useState<FileItem | null>(null);

      // "Случайное фото" lands here from the sidebar via the store.
  // Consume it during render (React's "adjusting state when a prop changes"
  // pattern) and clear the store entry afterward - never synchronously at
  // the top of an effect.

  const [consumedPreview, setConsumedPreview] = React.useState<FileItem | null>(null);
  if (pendingPreview && consumedPreview !== pendingPreview) {
    setConsumedPreview(pendingPreview);
    setPreviewItem(pendingPreview);
  }
  React.useEffect(() => {
    if (pendingPreview) setPendingPreview(null);
      }, [pendingPreview, setPendingPreview]);

  const [moveItems, setMoveItems] = React.useState<FileItem[] | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{
    item: FileItem;
    x: number;
    y: number;
  } | null>(null);

  const [emptyingTrash, setEmptyingTrash] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectionAnchorId, setSelectionAnchorId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  // Roving keyboard cursor (arrow-key navigation). -1 = inactive.
  const [cursorIndex, setCursorIndex] = React.useState(-1);

  // ---- Query: list items ----
  //
  // For shared-view we have two modes:
  //   - top-level (no folder opened yet): fetch /api/shares/shared-with-me
  //     and render the list of shared folders as FileItem-like rows.
  //   - inside a folder: fetch /api/files/list?sharedFolderId=...&parentId=...
  const isSharedRootList = view === "shared" && !currentSharedFolderId;

  const { data: sharedWithMeData, isLoading: sharedLoading } = useQuery({
    queryKey: ["shared-with-me"],
    queryFn: () => api.listSharedWithMe(),
    enabled: isSharedRootList,
  });

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["files", currentFolderId, view, currentSharedFolderId],
    queryFn: ({ pageParam }) => {
      if (view === "trash") {
        return api.listFiles(null, { trashed: true, cursor: pageParam });
      }
      if (view === "shared" && currentSharedFolderId) {
        return api.listFiles(currentFolderId, {
          sharedFolderId: currentSharedFolderId,
          cursor: pageParam,
        });
      }
      if (view === "shared" && !currentSharedFolderId) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      return api.listFiles(currentFolderId, { cursor: pageParam });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    enabled: !isSharedRootList,
  });

  // Public settings (used for trashRetentionDays display).
  const { data: publicSettings } = useQuery({
    queryKey: ["public-settings"],
    queryFn: () => api.getPublicSettings(),
    staleTime: 5 * 60_000,
  });

  // Effective items: for shared-root view, project shared-with-me into
  // FileItem rows (folders AND files).
  const items: FileItem[] = React.useMemo(() => {
    if (isSharedRootList) {
      return (sharedWithMeData?.items ?? []).map((s) => {
        const isDirectory = s.isDirectory ?? true;
        return {
          id: s.nodeId ?? s.folderId,
          parentId: null,
          name: s.nodeName ?? s.folderName,
          isDirectory,
          sizeBytes: s.sizeBytes ?? "0",
          mimeType: s.mimeType ?? (isDirectory ? "inode/directory" : "application/octet-stream"),
          category: s.category ?? ("other" as const),
          deletedAt: null,
          createdAt: s.createdAt,
          updatedAt: s.createdAt,
          isShared: true,
          permission: s.permission,
          // SharedItem.id — required by list/mkdir/upload/move APIs for folders.
          sharedFolderId: s.id,
        };
      });
    }
    return data?.pages.flatMap((p) => p.items) ?? [];
  }, [isSharedRootList, sharedWithMeData, data]);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const loadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const trashRetentionDays = publicSettings?.trashRetentionDays ?? 30;

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["shared-with-me"] });
  }, [qc]);

  const canEdit = !isInsideShared || currentPermission === "edit";
  const canUpload = !isInsideShared || currentPermission === "upload" || currentPermission === "edit";

  const handleUploadClick = React.useCallback(() => {
    // Never trigger the file picker while in trash/settings/admin views —
    // uploads only make sense inside a real folder.
    if (view === "trash" || view === "settings" || view === "admin" || view === "shared-by-me") return;
    if (isSharedRootList) {
      toast.info("Сначала откройте одну из общих папок");
      return;
    }
    if (!canUpload) {
      toast.error("У вас нет прав на загрузку в эту папку");
      return;
    }
    fileInputRef.current?.click();
  }, [view, isSharedRootList, canUpload]);

  const handleFilesSelected = React.useCallback(
    (files: FileList | File[], originX?: number, originY?: number) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      // Droplet burst (DropGlow) from the drop point.
      if (originX !== undefined && originY !== undefined) {
        fireDropGlow(originX, originY, Math.min(20, 8 + arr.length * 2));
      }
      setPendingFiles(arr);
      setUploadVisible(true);
    },
    [setUploadVisible]
  );

  const handleUploadDone = React.useCallback(() => {
    setPendingFiles([]);
    setResumeByFileKey(undefined);
    setUploadVisible(false);
    refresh();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [refresh, setUploadVisible]);

  const handleUploadCancel = React.useCallback(() => {
    setPendingFiles([]);
    setResumeByFileKey(undefined);
    setUploadVisible(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [setUploadVisible]);

  // After login / mount: offer to continue chunked uploads interrupted by tab close.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pending = await listPendingUploads(user.id);
        if (cancelled || pending.length === 0) return;
        const stillAlive: PendingUploadRecord[] = [];
        for (const rec of pending) {
          const status = await api.getUploadStatus(rec.uploadId);
          if (status.exists) stillAlive.push(rec);
          else await deletePendingUploads([rec.uploadId]).catch(() => undefined);
        }
        if (!cancelled && stillAlive.length > 0) setResumeBanner(stillAlive);
      } catch {
        // IndexedDB / network — ignore quietly
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const continueResumes = React.useCallback(async () => {
    if (!resumeBanner?.length) return;
    const map: Record<
      string,
      { uploadId: string; parentId: string | null; sharedFolderId: string | null }
    > = {};
    const files: File[] = [];
    for (const rec of resumeBanner) {
      const file = blobToFile(rec);
      files.push(file);
      map[fileResumeKey(file)] = {
        uploadId: rec.uploadId,
        parentId: rec.parentId,
        sharedFolderId: rec.sharedFolderId,
      };
    }
    setResumeBanner(null);
    setResumeByFileKey(map);
    setPendingFiles(files);
    setUploadVisible(true);
    toast.message("Продолжаем незавершённые загрузки");
  }, [resumeBanner, setUploadVisible]);

  const discardResumes = React.useCallback(async () => {
    if (!resumeBanner?.length) return;
    const ids = resumeBanner.map((r) => r.uploadId);
    for (const id of ids) {
      await api.abortUpload(id);
    }
    await deletePendingUploads(ids).catch(() => undefined);
    setResumeBanner(null);
    toast.message("Незавершённые загрузки отменены");
  }, [resumeBanner]);

  const handleMkdir = React.useCallback(async () => {
    if (isSharedRootList) {
      toast.info("Сначала откройте одну из общих папок");
      return;
    }
    if (isInsideShared && !canEdit) {
      toast.error("У вас нет прав на создание папок здесь");
      return;
    }
    const name = await promptDialog({
      title: "Новая папка",
      description: "Введите имя для новой папки в текущей директории.",
      label: "Имя папки",
      placeholder: "например, Фото 2026",
      confirmText: "Создать",
      minLength: 1,
      maxLength: 255,
    });
    if (!name) return;
    try {
      await api.mkdir(
        name,
        view === "trash" ? null : currentFolderId,
        isInsideShared ? { sharedFolderId: currentSharedFolderId } : undefined
      );
      toast.success("Папка создана");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать папку");
    }
  }, [view, currentFolderId, refresh, isInsideShared, currentSharedFolderId, canEdit, isSharedRootList]);

  const handleEmptyTrash = async () => {
    if (items.length === 0) return;
    const ok = await confirmDialog({
      title: "Очистить корзину?",
      description: `${items.length} ${plural(items.length, "объект", "объекта", "объектов")} будет удалено навсегда. Это действие необратимо.`,
      confirmText: "Очистить",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
    setEmptyingTrash(true);
    try {
      const result = await api.emptyTrash();
      toast.success(`Удалено навсегда: ${result.purgedCount}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось очистить корзину");
    } finally {
      setEmptyingTrash(false);
    }
  };

  // Open item — folder → navigate; file → preview.
  // Trash: folders are dead (no tree); files stay closed — download/preview
  // APIs reject soft-deleted nodes, so opening would show a broken preview.
  const openItem = React.useCallback(
    (item: FileItem) => {
      if (view === "trash") return;
      if (item.isDirectory) {
        if (view === "shared" && !currentSharedFolderId) {
          if (!item.sharedFolderId) {
            toast.error("Не удалось открыть общую папку");
            return;
          }
          pushSharedFolder(
            item.id,
            item.name,
            item.sharedFolderId,
            item.permission ?? "view"
          );
        } else {
          pushFolder(item.id, item.name);
        }
      } else {
        setPreviewItem(item);
      }
    },
    [view, pushFolder, pushSharedFolder, currentSharedFolderId]
  );

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
    setSelectionAnchorId(null);
  }, []);

    // Leave selection when navigating folders / switching views.
  // Driven in render phase via an evergreening key so the state reset
  // isn't a synchronous setState at the top of an effect.
  const navKey = [view, currentFolderId, currentSharedFolderId].join("|");
  const [prevNavKey, setPrevNavKey] = React.useState(navKey);
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey);
    clearSelection();
    setCursorIndex(-1);
  }

  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectionAnchorId(id);
    setSelectionMode(true);
  }, []);

  const selectRange = React.useCallback(
    (toId: string) => {
      const toIdx = items.findIndex((i) => i.id === toId);
      if (toIdx < 0) return;
      const fromIdx = selectionAnchorId
        ? items.findIndex((i) => i.id === selectionAnchorId)
        : toIdx;
      const start = Math.min(fromIdx < 0 ? toIdx : fromIdx, toIdx);
      const end = Math.max(fromIdx < 0 ? toIdx : fromIdx, toIdx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(items[i]!.id);
        return next;
      });
      if (!selectionAnchorId) setSelectionAnchorId(toId);
      setSelectionMode(true);
    },
    [items, selectionAnchorId]
  );

  // ---- Keyboard navigation over the file list ----
  // The scroll container is tabbable; arrows move a roving cursor, Enter opens,
  // Space toggles selection, Escape resets. In grid layout Up/Down jump a full
  // row (column count derived from the same breakpoints as FileGrid).
  const safeCursorIndex =
    cursorIndex >= 0 && cursorIndex < items.length ? cursorIndex : -1;
  const cursorId = safeCursorIndex >= 0 ? items[safeCursorIndex]!.id : undefined;

  const handleListKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Don't hijack keys while a modal / context menu is open (focus lives in
      // a portal, but a stale focused container could still receive events).
      if (contextMenu || previewItem || shareItem || moveItems) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (items.length === 0) return;

      const inGrid = layout === "grid";
      const cols = inGrid
        ? Math.max(1, gridColumnsFor(scrollRef.current?.clientWidth ?? 800))
        : 1;
      const last = items.length - 1;
      const move = (delta: number) => {
        e.preventDefault();
        setCursorIndex((prev) => {
          const base = prev < 0 ? 0 : prev;
          return Math.min(last, Math.max(0, base + delta));
        });
        // Prefetch next pages when the cursor approaches the loaded tail.
        loadMore();
      };

      switch (e.key) {
        case "ArrowDown":
          move(inGrid ? cols : 1);
          break;
        case "ArrowUp":
          move(inGrid ? -cols : -1);
          break;
        case "ArrowRight":
          if (inGrid) move(1);
          break;
        case "ArrowLeft":
          if (inGrid) move(-1);
          break;
        case "Home":
          e.preventDefault();
          setCursorIndex(0);
          loadMore();
          break;
        case "End":
          e.preventDefault();
          setCursorIndex(last);
          loadMore();
          break;
        case "Enter": {
          if (safeCursorIndex < 0) return;
          e.preventDefault();
          openItem(items[safeCursorIndex]!);
          break;
        }
        case " ": {
          if (safeCursorIndex < 0) return;
          e.preventDefault();
          toggleSelect(items[safeCursorIndex]!.id);
          break;
        }
        case "Escape":
          if (selectionMode || selectedIds.size > 0 || safeCursorIndex >= 0) {
            e.preventDefault();
            clearSelection();
            setCursorIndex(-1);
          }
          break;
      }
    },
    [
      items, layout, safeCursorIndex, openItem, toggleSelect, clearSelection,
      loadMore, scrollRef, contextMenu, previewItem, shareItem, moveItems,
      selectionMode, selectedIds,
    ]
  );

  // Keep the keyboard cursor visible while moving.
  React.useEffect(() => {
    if (safeCursorIndex < 0) return;
    const id = items[safeCursorIndex]?.id;
    if (!id) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-file-item="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [safeCursorIndex, items, scrollRef]);

  /** Body click: always open; clear selection chrome if any. */
  const onItemOpen = React.useCallback(
    (item: FileItem, _e: React.MouseEvent) => {
      if (selectedIds.size > 0 || selectionMode) {
        clearSelection();
      }
      openItem(item);
    },
    [selectedIds.size, selectionMode, clearSelection, openItem]
  );

  /** Checkbox / Cmd / Shift. */
  const onItemToggle = React.useCallback(
    (item: FileItem, e: React.MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        selectRange(item.id);
        return;
      }
      e.preventDefault();
      toggleSelect(item.id);
    },
    [selectRange, toggleSelect]
  );

  const onItemContextMenu = React.useCallback((e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  }, []);

  const onItemLongPress = React.useCallback(
    (item: FileItem, coords: { x: number; y: number }) => {
      if (selectionMode || selectedIds.size > 0) {
        toggleSelect(item.id);
        return;
      }
      setContextMenu({ item, x: coords.x, y: coords.y });
    },
    [selectionMode, selectedIds.size, toggleSelect]
  );

  const selectedItems = React.useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  const canBulkTrash =
    (view === "files" || (view === "shared" && canEdit)) && !isSharedRootList;
  const canBulkMove = canBulkTrash;
  const canBulkRestore = view === "trash";
  const canBulkPurge = view === "trash";
  const canBulkDownload =
    view !== "trash" && selectedItems.some((i) => !i.isDirectory);

  const handleBulkTrash = React.useCallback(async () => {
    if (!canBulkTrash || selectedItems.length === 0) return;
    const n = selectedItems.length;
    const ok = await confirmDialog({
      title: "В корзину?",
      description: `${n} ${plural(n, "объект", "объекта", "объектов")} будет перемещено в корзину.`,
      confirmText: "В корзину",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      let okN = 0;
      let failN = 0;
      for (const it of selectedItems) {
        try {
          await api.trash(it.id);
          okN += 1;
        } catch {
          failN += 1;
        }
      }
      toastBulkResult(toast, { ok: okN, fail: failN }, {
        one: "Перемещено в корзину",
        many: (c) => `В корзине: ${c}`,
        partial: (o, f) => `В корзине: ${o}, ошибок: ${f}`,
      });
      clearSelection();
      refresh();
      scrollRef.current?.focus({ preventScroll: true });
    } finally {
      setBulkBusy(false);
    }
  }, [canBulkTrash, selectedItems, clearSelection, refresh]);

  const handleBulkRestore = React.useCallback(async () => {
    if (!canBulkRestore || selectedItems.length === 0) return;
    setBulkBusy(true);
    try {
      let okN = 0;
      let failN = 0;
      for (const it of selectedItems) {
        try {
          await api.restore(it.id);
          okN += 1;
        } catch {
          failN += 1;
        }
      }
      toastBulkResult(toast, { ok: okN, fail: failN }, {
        one: "Восстановлено",
        many: (c) => `Восстановлено: ${c}`,
        partial: (o, f) => `Восстановлено: ${o}, ошибок: ${f}`,
      });
      clearSelection();
      refresh();
      scrollRef.current?.focus({ preventScroll: true });
    } finally {
      setBulkBusy(false);
    }
  }, [canBulkRestore, selectedItems, clearSelection, refresh]);

  const handleBulkPurge = React.useCallback(async () => {
    if (!canBulkPurge || selectedItems.length === 0) return;
    const n = selectedItems.length;
    const ok = await confirmDialog({
      title: "Удалить навсегда?",
      description: `${n} ${plural(n, "объект", "объекта", "объектов")} будет удалено безвозвратно.`,
      confirmText: "Удалить",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      let okN = 0;
      let failN = 0;
      for (const it of selectedItems) {
        try {
          await api.purge(it.id);
          okN += 1;
        } catch {
          failN += 1;
        }
      }
      toastBulkResult(toast, { ok: okN, fail: failN }, {
        one: "Удалено навсегда",
        many: (c) => `Удалено: ${c}`,
        partial: (o, f) => `Удалено: ${o}, ошибок: ${f}`,
      });
      clearSelection();
      refresh();
      scrollRef.current?.focus({ preventScroll: true });
    } finally {
      setBulkBusy(false);
    }
  }, [canBulkPurge, selectedItems, clearSelection, refresh]);

  const handleBulkDownload = React.useCallback(async () => {
    const files = selectedItems.filter((i) => !i.isDirectory);
    const skippedDirs = selectedItems.length - files.length;
    if (files.length === 0) {
      toast.info("Выберите файлы (папки так скачать нельзя)");
      return;
    }
    if (skippedDirs > 0) {
      toast.message(
        `Папки пропущены: ${skippedDirs}. Скачиваются только файлы.`
      );
    }
    if (files.length === 1) {
      const f = files[0]!;
      const a = document.createElement("a");
      a.href = api.downloadUrl(f.id);
      a.download = f.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.message("Скачивание начато");
      return;
    }
    try {
      api.downloadZip(files.map((f) => f.id));
      toast.message(`Архив: ${files.length} ${plural(files.length, "файл", "файла", "файлов")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось скачать архив");
    }
  }, [selectedItems]);

  const enterSelectFromMenu = React.useCallback((item: FileItem) => {
    setSelectionMode(true);
    setSelectedIds(new Set([item.id]));
    setSelectionAnchorId(item.id);
    setContextMenu(null);
  }, []);

  const selectAllVisible = React.useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
    setSelectionMode(true);
  }, [items]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === "Escape" && (selectedIds.size > 0 || selectionMode)) {
        clearSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && items.length > 0) {
        if (view === "settings" || view === "admin" || view === "shared-by-me") return;
        e.preventDefault();
        selectAllVisible();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        if (view === "trash" && canBulkPurge) {
          e.preventDefault();
          void handleBulkPurge();
        } else if (canBulkTrash) {
          e.preventDefault();
          void handleBulkTrash();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedIds.size,
    selectionMode,
    clearSelection,
    items.length,
    view,
    selectAllVisible,
    canBulkTrash,
    canBulkPurge,
    handleBulkTrash,
    handleBulkPurge,
  ]);

  const onScrollBackgroundClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (selectedIds.size > 0 || selectionMode) clearSelection();
    },
    [selectedIds.size, selectionMode, clearSelection]
  );

  // Preview navigation — show next/previous file in the current folder.
  const previewIndex = previewItem ? items.findIndex((i) => i.id === previewItem.id) : -1;
  const goPrev = React.useCallback(() => {
    if (previewIndex > 0) setPreviewItem(items[previewIndex - 1]);
  }, [previewIndex, items]);
  const goNext = React.useCallback(() => {
    if (previewIndex >= 0 && previewIndex < items.length - 1) setPreviewItem(items[previewIndex + 1]);
  }, [previewIndex, items]);

  // Decide which views show the toolbar buttons.
  const canShowMkdir = view !== "trash" && !isSharedRootList && canEdit;
  const canShowUpload = view !== "trash" && !isSharedRootList && canUpload;
  const showSelectionChrome = selectedIds.size > 0 || selectionMode;

  return (
    <div className="flex min-h-screen flex-col">
      <CloudHeader user={user} onLogout={onLogout} />

      {resumeBanner && resumeBanner.length > 0 && (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
          data-testid="upload-resume-banner"
        >
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <RotateCcw className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <div className="font-medium">
                Незавершённые загрузки: {resumeBanner.length}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {resumeBanner.map((r) => r.fileName).join(", ")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={discardResumes} className="h-9">
              Отменить
            </Button>
            <Button size="sm" onClick={continueResumes} className="h-9 gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Продолжить
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <CloudSidebar user={user} />

        {/* Settings & Admin views replace the file browser */}
        {view === "settings" && (
          <main className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <SettingsView user={user} onUserUpdated={onUserUpdated ?? (() => undefined)} onLogout={onLogout} />
          </main>
        )}
        {view === "admin" && user.role === "admin" && (
          <main className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <AdminView currentUser={user} onUserUpdated={onUserUpdated ?? (() => undefined)} />
          </main>
        )}
        {view === "shared-by-me" && (
          <main className="flex-1 overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <MySharesView />
          </main>
        )}

        {view !== "settings" && view !== "admin" && view !== "shared-by-me" && (
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10 min-h-12">
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
              {items.length > 0 && !showSelectionChrome && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectionMode(true)}
                  className="gap-1.5 h-9 min-w-9 sm:min-w-0"
                  title="Выбрать несколько"
                  aria-label="Выбрать"
                >
                  <CheckSquare className="h-4 w-4" />
                  <span className="hidden md:inline">Выбрать</span>
                </Button>
              )}
              {view !== "trash" && view !== "shared" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMkdir}
                    className="gap-1.5 h-9 min-w-9 sm:min-w-0"
                  >
                    <FolderPlus className="h-4 w-4" />
                    <span className="hidden sm:inline">Папка</span>
                  </Button>
                  {/* Primary upload lives in the empty-state CTA when the
                      folder is empty — avoid a second identical button. */}
                  {items.length > 0 && (
                    <Button
                      size="sm"
                      onClick={handleUploadClick}
                      className="gap-1.5 shadow-sm h-9 min-w-9 sm:min-w-0"
                    >
                      <Upload className="h-4 w-4" />
                      <span className="hidden sm:inline">Загрузить</span>
                    </Button>
                  )}
                  <LayoutToggle />
                </>
              )}
              {view === "shared" && !isSharedRootList && canShowMkdir && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMkdir}
                  className="gap-1.5 h-9 min-w-9 sm:min-w-0"
                >
                  <FolderPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">Папка</span>
                </Button>
              )}
              {/* Upload in shared folders: toolbar when non-empty; empty-state CTA when empty. */}
              {view === "shared" && !isSharedRootList && canShowUpload && items.length > 0 && (
                <Button
                  size="sm"
                  onClick={handleUploadClick}
                  className="gap-1.5 shadow-sm h-9 min-w-9 sm:min-w-0"
                >
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Загрузить</span>
                </Button>
              )}
              {view === "shared" && !isSharedRootList && <LayoutToggle />}
              {view === "shared" && isSharedRootList && <LayoutToggle />}
              {view === "trash" && (
                <>
                  <span
                    className="hidden sm:inline-flex text-xs text-muted-foreground items-center gap-1.5 px-2"
                    title={
                      trashRetentionDays > 0
                        ? `Файлы удаляются навсегда через ${trashRetentionDays} ${plural(trashRetentionDays, "день", "дня", "дней")}`
                        : "Автоочистка отключена"
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    {trashRetentionDays > 0
                      ? `${trashRetentionDays} ${plural(trashRetentionDays, "день", "дня", "дней")}`
                      : "Без автоочистки"}
                  </span>
                  {items.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEmptyTrash}
                      disabled={emptyingTrash}
                      className="gap-1.5 text-destructive hover:bg-destructive/10 h-9 min-w-9 sm:min-w-0"
                    >
                      {emptyingTrash ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">Очистить</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {showSelectionChrome && (
            <SelectionToolbar
              count={selectedIds.size}
              totalVisible={items.length}
              view={view as "files" | "trash" | "shared"}
              busy={bulkBusy}
              hasMorePages={!!hasNextPage}
              canTrash={canBulkTrash}
              canMove={canBulkMove}
              canRestore={canBulkRestore}
              canPurge={canBulkPurge}
              canDownload={canBulkDownload}
              onSelectAll={selectAllVisible}
              onClear={clearSelection}
              onTrash={handleBulkTrash}
              onMove={() => setMoveItems(selectedItems)}
              onRestore={handleBulkRestore}
              onPurge={handleBulkPurge}
              onDownload={handleBulkDownload}
            />
          )}

          {/* Shared-view permission chip */}
          {view === "shared" && isInsideShared && currentPermission && (
            <div className="px-3 sm:px-4 py-1.5 border-b border-border/40 bg-muted/20 flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[11px] font-medium"
                title={PERM_DESCRIPTION[currentPermission]}
              >
                {PERM_LABEL[currentPermission]}
              </span>
              <span className="hidden md:inline text-xs text-muted-foreground truncate">
                {PERM_DESCRIPTION[currentPermission]}
              </span>
            </div>
          )}

          <UploadDropzone
            onFilesDropped={(files, x, y) => handleFilesSelected(files, x, y)}
            disabled={view === "trash" || (isInsideShared && !canUpload) || isSharedRootList}
          >
            <div
              ref={scrollRef}
              tabIndex={0}
              role="listbox"
              aria-label="Файлы и папки"
              onKeyDown={handleListKeyDown}
              onClick={onScrollBackgroundClick}
              className="flex-1 overflow-y-auto p-4 pb-[max(7.5rem,calc(4.5rem+env(safe-area-inset-bottom)))] md:pb-[max(6rem,calc(1.5rem+env(safe-area-inset-bottom)))] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20"
            >
              {isLoading || (isSharedRootList && sharedLoading) ? (
                layout === "list" ? <FileListSkeleton /> : <FileGridSkeleton />
              ) : items.length === 0 ? (
                view === "shared" && isSharedRootList ? (
                  <EmptyState view="shared-root" />
                ) : view === "shared" ? (
                  <EmptyState
                    view="shared-folder"
                    canUpload={canUpload}
                    onUploadClick={handleUploadClick}
                  />
                ) : (
                  <EmptyState
                    view={view as "files" | "trash"}
                    onUploadClick={handleUploadClick}
                    trashRetentionDays={trashRetentionDays}
                  />
                )
              ) : layout === "grid" ? (
                <FileGrid
                  items={items}
                  view={view as "files" | "trash" | "shared"}
                  onItemOpen={onItemOpen}
                  onItemToggle={onItemToggle}
                  onItemContext={onItemContextMenu}
                  onItemLongPress={onItemLongPress}
                  selectedIds={selectedIds}
                  selectionMode={selectionMode || selectedIds.size > 0}
                  cursorId={cursorId}
                  scrollRef={scrollRef}
                  hasMore={!!hasNextPage}
                  isFetchingMore={isFetchingNextPage}
                  onLoadMore={loadMore}
                />
              ) : (
                <FileList
                  items={items}
                  view={view as "files" | "trash" | "shared"}
                  onItemOpen={onItemOpen}
                  onItemToggle={onItemToggle}
                  onItemContext={onItemContextMenu}
                  onItemLongPress={onItemLongPress}
                  selectedIds={selectedIds}
                  selectionMode={selectionMode || selectedIds.size > 0}
                  cursorId={cursorId}
                  scrollRef={scrollRef}
                  hasMore={!!hasNextPage}
                  isFetchingMore={isFetchingNextPage}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          </UploadDropzone>
        </main>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
      />

      <UploadOverlay
        files={pendingFiles}
        parentId={
          resumeByFileKey
            ? (Object.values(resumeByFileKey)[0]?.parentId ?? null)
            : view === "trash"
              ? null
              : currentFolderId
        }
        onDone={handleUploadDone}
        onCancel={handleUploadCancel}
        sharedFolderId={
          resumeByFileKey
            ? (Object.values(resumeByFileKey)[0]?.sharedFolderId ?? undefined)
            : isInsideShared
              ? currentSharedFolderId
              : undefined
        }
        ownerUserId={user.id}
        resumeByFileKey={resumeByFileKey}
      />

      {previewItem && (
        <FilePreviewDialog
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onShare={(it) => {
            setPreviewItem(null);
            setShareItem(it);
          }}
          onPrev={previewIndex > 0 ? goPrev : undefined}
          onNext={previewIndex >= 0 && previewIndex < items.length - 1 ? goNext : undefined}
        />
      )}

      {shareItem && (
        <ShareDialog item={shareItem} onClose={() => setShareItem(null)} />
      )}

      {moveItems && moveItems.length > 0 && (
        <MoveDialog
          items={moveItems}
          onClose={() => setMoveItems(null)}
          onMoved={() => {
            setMoveItems(null);
            clearSelection();
            refresh();
          }}
          sharedFolderId={isInsideShared ? currentSharedFolderId : undefined}
          shareRootName={isInsideShared ? path[0]?.name : undefined}
        />
      )}

      {contextMenu && (
        <FileContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpen={openItem}
          onPreview={(it) => setPreviewItem(it)}
          onShare={(it) => setShareItem(it)}
          onRenamed={refresh}
          onTrashed={refresh}
          onRestored={refresh}
          onPurged={refresh}
          onMove={(it) => setMoveItems([it])}
          onSelect={enterSelectFromMenu}
          view={view as "files" | "trash" | "shared"}
          permission={
            view === "shared"
              ? (currentPermission ?? contextMenu.item.permission)
              : undefined
          }
          sharedFolderId={
            isInsideShared
              ? currentSharedFolderId
              : contextMenu.item.sharedFolderId
          }
        />
      )}

      {/* Atmospheric droplet burst when files are dropped */}
      <DropGlow />

      <MobileBottomNav user={user} />
    </div>
  );
}

function LayoutToggle() {
  const layout = useCloudStore((s) => s.layout);
  const setLayout = useCloudStore((s) => s.setLayout);
  return (
    <div className="flex items-center rounded-lg border border-border/60 p-0.5 bg-muted/30">
      <Button
        size="sm"
        variant={layout === "grid" ? "secondary" : "ghost"}
        className={cn("h-8 w-8 px-0", layout === "grid" && "shadow-sm")}
        onClick={() => setLayout("grid")}
        aria-label="Сетка"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      </Button>
      <Button
        size="sm"
        variant={layout === "list" ? "secondary" : "ghost"}
        className={cn("h-8 w-8 px-0", layout === "list" && "shadow-sm")}
        onClick={() => setLayout("list")}
        aria-label="Список"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="2" rx="1" />
          <rect x="1" y="7" width="14" height="2" rx="1" />
          <rect x="1" y="12" width="14" height="2" rx="1" />
        </svg>
      </Button>
    </div>
  );
}
