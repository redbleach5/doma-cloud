"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Folder, Home, ChevronRight, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { plural } from "@/lib/cloud/plural";

interface Props {
  /** One or more items to move. */
  items: FileItem[];
  onClose: () => void;
  onMoved: () => void;
  sharedFolderId?: string;
  shareRootName?: string;
}

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

export function MoveDialog({
  items,
  onClose,
  onMoved,
  sharedFolderId,
  shareRootName,
}: Props) {
  const [crumbs, setCrumbs] = React.useState<FolderNode[]>([]);
  const [children, setChildren] = React.useState<FolderNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [moving, setMoving] = React.useState(false);

  const itemList = items;
  const primary = itemList[0]!;
  const isShared = !!sharedFolderId;
  const rootLabel = isShared ? (shareRootName ?? "Общая папка") : "Корень";
  const currentParentId = crumbs.length === 0 ? null : crumbs[crumbs.length - 1]!.id;
  const movingIds = React.useMemo(() => new Set(itemList.map((i) => i.id)), [itemList]);

  const title =
    itemList.length === 1
      ? `Переместить «${primary.name}»`
      : `Переместить ${itemList.length} ${plural(itemList.length, "объект", "объекта", "объектов")}`;

  const loadFolder = React.useCallback(
    async (parentId: string | null) => {
      setLoading(true);
      try {
        const { items: listed } = await api.listFiles(
          parentId,
          sharedFolderId ? { sharedFolderId } : undefined
        );
        setChildren(
          listed
            .filter((i) => i.isDirectory)
            .map((i) => ({ id: i.id, name: i.name, parentId: i.parentId }))
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось загрузить папки");
        setChildren([]);
      } finally {
        setLoading(false);
      }
    },
    [sharedFolderId]
  );

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFolder(null);
  }, [loadFolder]);

  const descend = (folder: FolderNode) => {
    if (movingIds.has(folder.id)) {
      toast.error("Нельзя переместить папку внутрь себя");
      return;
    }
    setCrumbs((c) => [...c, folder]);
    loadFolder(folder.id);
  };

  const popTo = (index: number) => {
    setCrumbs((c) => c.slice(0, index + 1));
    loadFolder(crumbs[index]?.id ?? null);
  };

  const goToRoot = () => {
    setCrumbs([]);
    loadFolder(null);
  };

  const allSameParent =
    !isShared && itemList.every((it) => it.parentId === currentParentId);

  const moveHere = async () => {
    if (allSameParent) {
      toast.info("Уже в этой папке");
      return;
    }
    for (const it of itemList) {
      if (!it.isDirectory) continue;
      const isSelfOrDescendant =
        crumbs.some((c) => c.id === it.id) || currentParentId === it.id;
      if (isSelfOrDescendant) {
        toast.error(`Нельзя переместить «${it.name}» в себя или потомка`);
        return;
      }
    }

    setMoving(true);
    let ok = 0;
    let fail = 0;
    let skipped = 0;
    try {
      for (const it of itemList) {
        if (!isShared && it.parentId === currentParentId) {
          skipped += 1;
          continue;
        }
        try {
          const result = await api.move(
            it.id,
            currentParentId,
            sharedFolderId ? { sharedFolderId } : undefined
          );
          if (result.moved) ok += 1;
          else skipped += 1;
        } catch {
          fail += 1;
        }
      }
      if (fail === 0 && ok > 0) {
        toast.success(
          ok === 1
            ? `«${primary.name}» перемещён`
            : `Перемещено: ${ok}`
        );
      } else if (ok === 0 && fail === 0) {
        toast.info("Уже в этой папке");
      } else if (ok === 0) {
        toast.error("Не удалось переместить");
      } else {
        toast.message(`Перемещено: ${ok}, ошибок: ${fail}${skipped ? `, пропущено: ${skipped}` : ""}`);
      }
      onMoved();
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-sm:h-[min(90dvh,calc(100dvh-env(safe-area-inset-top)))]">
        <DialogHeader>
          <DialogTitle className="truncate pr-2">{title}</DialogTitle>
          <DialogDescription>
            {isShared
              ? "Выберите папку внутри общей."
              : "Выберите папку назначения."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2 !py-2">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            <button
              type="button"
              onClick={goToRoot}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition"
            >
              <Home className="h-3.5 w-3.5" />
              <span>{rootLabel}</span>
            </button>
            {crumbs.map((c, i) => (
              <React.Fragment key={c.id}>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => popTo(i)}
                  className="px-2 py-1 rounded hover:bg-accent transition truncate max-w-32"
                  title={c.name}
                >
                  {c.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="border border-border/60 rounded-lg flex-1 min-h-40 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Загрузка…
              </div>
            ) : children.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Нет вложенных папок
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {children.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => descend(c)}
                    disabled={movingIds.has(c.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Folder className="h-4 w-4 text-primary shrink-0" />
                    <span className="flex-1 truncate text-sm">{c.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <div className="text-xs text-muted-foreground hidden sm:block">
            Назначение: {crumbs.length === 0 ? rootLabel : crumbs[crumbs.length - 1]!.name}
          </div>
          <div className="flex w-full sm:w-auto gap-2">
            <Button variant="outline" onClick={onClose} disabled={moving} className="flex-1 sm:flex-none">
              Отмена
            </Button>
            <Button
              onClick={moveHere}
              disabled={moving || allSameParent}
              className="gap-1.5 flex-1 sm:flex-none"
            >
              {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Сюда
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
