"use client";

import * as React from "react";
import { api, type CurrentUser, type FileItem } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { CloudHeader } from "@/components/cloud/cloud-header";
import { CloudSidebar } from "@/components/cloud/cloud-sidebar";
import { Breadcrumbs } from "@/components/cloud/breadcrumbs";
import { FileGrid } from "@/components/cloud/file-grid";
import { FileList } from "@/components/cloud/file-list";
import { UploadDropzone } from "@/components/cloud/upload-dropzone";
import { UploadOverlay } from "@/components/cloud/upload-overlay";
import { FileContextMenu } from "@/components/cloud/file-context-menu";
import { FilePreviewDialog } from "@/components/cloud/file-preview-dialog";
import { ShareDialog } from "@/components/cloud/share-dialog";
import { EmptyState } from "@/components/cloud/empty-state";
import { DropBurst, fireDropBurst } from "@/components/cloud/atmosphere/drop-burst";
import { SettingsView } from "@/components/cloud/settings-view";
import { AdminView } from "@/components/cloud/admin-view";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, FolderPlus, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  user: CurrentUser;
  onLogout: () => void;
  onUserUpdated?: (user: CurrentUser) => void;
}

export function FileBrowser({ user, onLogout, onUserUpdated }: Props) {
  const qc = useQueryClient();
  const { view, layout, path, setUploadVisible, pushFolder } = useCloudStore();
  const currentFolderId = path[path.length - 1]?.id ?? null;

  // File input ref for "Upload" button.
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [previewItem, setPreviewItem] = React.useState<FileItem | null>(null);
  const [shareItem, setShareItem] = React.useState<FileItem | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{
    item: FileItem;
    x: number;
    y: number;
  } | null>(null);

  // List query.
  const listKey = ["files", currentFolderId, view];
  const { data, isLoading, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      view === "trash"
        ? api.listFiles(null, { trashed: true })
        : api.listFiles(currentFolderId),
  });

  const items = data?.items ?? [];

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFilesSelected = (files: FileList | File[], originX?: number, originY?: number) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    // Fire the droplet burst from the drop point — pure delight moment.
    if (originX !== undefined && originY !== undefined) {
      fireDropBurst(originX, originY, Math.min(20, 8 + arr.length * 2));
    }
    setPendingFiles(arr);
    setUploadVisible(true);
  };

  const handleUploadDone = () => {
    setPendingFiles([]);
    setUploadVisible(false);
    refresh();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUploadCancel = () => {
    setPendingFiles([]);
    setUploadVisible(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleMkdir = async () => {
    const name = window.prompt("Имя новой папки:");
    if (!name?.trim()) return;
    try {
      await api.mkdir(name.trim(), view === "trash" ? null : currentFolderId);
      toast.success("Папка создана");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать папку");
    }
  };

  // Open item — folder → navigate; file → preview.
  const openItem = (item: FileItem) => {
    if (view === "trash") return; // No navigation in trash
    if (item.isDirectory) {
      pushFolder(item.id, item.name);
    } else {
      setPreviewItem(item);
    }
  };

  // Context menu triggers.
  const onItemContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  };

  const onItemLongPress = (item: FileItem, e: React.TouchEvent) => {
    const touch = e.touches[0] ?? (e.changedTouches[0] as Touch);
    if (touch) {
      setContextMenu({ item, x: touch.clientX, y: touch.clientY });
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <CloudHeader user={user} onLogout={onLogout} onUploadClick={handleUploadClick} />

      <div className="flex flex-1 overflow-hidden">
        <CloudSidebar user={user} onUploadClick={handleUploadClick} />

        {/* Settings & Admin views replace the file browser */}
        {view === "settings" && (
          <main className="flex-1 overflow-y-auto">
            <SettingsView user={user} onUserUpdated={onUserUpdated ?? (() => undefined)} onLogout={onLogout} />
          </main>
        )}
        {view === "admin" && user.role === "admin" && (
          <main className="flex-1 overflow-y-auto">
            <AdminView currentUser={user} onUserUpdated={onUserUpdated ?? (() => undefined)} />
          </main>
        )}

        {view !== "settings" && view !== "admin" && (
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-1.5">
              {view !== "trash" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMkdir}
                    className="gap-1.5"
                  >
                    <FolderPlus className="h-4 w-4" />
                    <span className="hidden sm:inline">Папка</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUploadClick}
                    className="gap-1.5"
                  >
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">Загрузить</span>
                  </Button>
                  <LayoutToggle />
                </>
              )}
              {view === "trash" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-2">
                  <Trash2 className="h-3.5 w-3.5" />
                  Файлы удаляются навсегда через 30 дней
                </span>
              )}
            </div>
          </div>

          <UploadDropzone
            onFilesDropped={(files, x, y) => handleFilesSelected(files, x, y)}
            disabled={view === "trash"}
          >
            <div className="flex-1 overflow-y-auto p-4 pb-24">
              {isLoading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Загрузка…
                </div>
              ) : items.length === 0 ? (
                <EmptyState view={view as "files" | "trash"} onUploadClick={handleUploadClick} />
              ) : layout === "grid" ? (
                <FileGrid
                  items={items}
                  view={view as "files" | "trash"}
                  onOpen={openItem}
                  onContext={onItemContextMenu}
                  onLongPress={onItemLongPress}
                />
              ) : (
                <FileList
                  items={items}
                  view={view as "files" | "trash"}
                  onOpen={openItem}
                  onContext={onItemContextMenu}
                  onLongPress={onItemLongPress}
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
        parentId={view === "trash" ? null : currentFolderId}
        onDone={handleUploadDone}
        onCancel={handleUploadCancel}
      />

      {previewItem && (
        <FilePreviewDialog
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onShare={(it) => {
            setPreviewItem(null);
            setShareItem(it);
          }}
          onDeleted={refresh}
        />
      )}

      {shareItem && (
        <ShareDialog item={shareItem} onClose={() => setShareItem(null)} />
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
          view={view as "files" | "trash"}
        />
      )}

      {/* Atmospheric droplet burst when files are dropped */}
      <DropBurst />
    </div>
  );
}

function LayoutToggle() {
  const { layout, setLayout } = useCloudStore();
  return (
    <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5">
      <Button
        size="sm"
        variant={layout === "grid" ? "secondary" : "ghost"}
        className={cn("h-7 px-2", layout === "grid" && "shadow-sm")}
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
        className={cn("h-7 px-2", layout === "list" && "shadow-sm")}
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
