"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MySharedFolderItem } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { File, Folder, Loader2, Trash2, Users, ExternalLink } from "lucide-react";
import { formatRelative } from "@/lib/cloud/format";
import { PERM_LABEL } from "@/lib/cloud/permissions";
import { confirmDialog } from "@/components/cloud/prompt-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NodeGroup {
  nodeId: string;
  nodeName: string;
  isDirectory: boolean;
  shares: MySharedFolderItem[];
}

export function MySharesView() {
  const qc = useQueryClient();
  const setView = useCloudStore((s) => s.setView);
  const pushFolder = useCloudStore((s) => s.pushFolder);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-shares"],
    queryFn: () => api.listMyShares(),
  });

  const groups = React.useMemo((): NodeGroup[] => {
    const map = new Map<string, NodeGroup>();
    for (const item of data?.items ?? []) {
      const nodeId = item.nodeId ?? item.folderId;
      const existing = map.get(nodeId);
      if (existing) {
        existing.shares.push(item);
      } else {
        map.set(nodeId, {
          nodeId,
          nodeName: item.nodeName ?? item.folderName,
          isDirectory: item.isDirectory ?? true,
          shares: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [data]);

  const openFolder = (folderId: string, folderName: string) => {
    setView("files");
    pushFolder(folderId, folderName);
  };

  const changePermission = async (
    item: MySharedFolderItem,
    permission: "view" | "upload" | "edit"
  ) => {
    if (permission === item.permission) return;
    setBusyId(item.id);
    try {
      await api.updateFolderShare(item.nodeId ?? item.folderId, item.id, permission);
      toast.success(`Права для ${item.recipientDisplayName}: ${PERM_LABEL[permission]}`);
      qc.invalidateQueries({ queryKey: ["my-shares"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось изменить права");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (item: MySharedFolderItem) => {
    const name = item.nodeName ?? item.folderName;
    const ok = await confirmDialog({
      title: "Отозвать доступ?",
      description: `${item.recipientDisplayName} (@${item.recipientUsername}) больше не сможет открыть «${name}».`,
      confirmText: "Отозвать",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await api.updateFolderShare(item.nodeId ?? item.folderId, item.id, null);
      toast.success("Доступ отозван");
      qc.invalidateQueries({ queryKey: ["my-shares"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отозвать доступ");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Мои общие</span>
        <span className="text-xs text-muted-foreground">
          файлы и папки, которыми вы поделились
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-[max(6rem,calc(1.5rem+env(safe-area-inset-bottom)))]">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загрузка…
          </div>
        ) : groups.length === 0 ? (
          <EmptyMyShares />
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {groups.map((group) => (
              <section
                key={group.nodeId}
                className="rounded-xl border border-border/60 bg-card overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/20">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    {group.isDirectory ? (
                      <Folder className="h-5 w-5 text-primary" fill="currentColor" fillOpacity={0.15} />
                    ) : (
                      <File className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" title={group.nodeName}>
                      {group.nodeName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {group.isDirectory ? "папка" : "файл"} · {group.shares.length}{" "}
                      {group.shares.length === 1
                        ? "получатель"
                        : group.shares.length < 5
                          ? "получателя"
                          : "получателей"}
                    </div>
                  </div>
                  {group.isDirectory && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => openFolder(group.nodeId, group.nodeName)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Открыть</span>
                    </Button>
                  )}
                </div>

                <ul className="divide-y divide-border/40">
                  {group.shares.map((share) => {
                    const busy = busyId === share.id;
                    const isFile = !(share.isDirectory ?? group.isDirectory);
                    const selectPerm =
                      isFile && share.permission === "upload" ? "view" : share.permission;
                    return (
                      <li
                        key={share.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {share.recipientDisplayName}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            @{share.recipientUsername}
                            {share.createdAt && (
                              <> · с {formatRelative(share.createdAt)}</>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Select
                            value={selectPerm}
                            disabled={busy}
                            onValueChange={(v) =>
                              changePermission(share, v as "view" | "upload" | "edit")
                            }
                          >
                            <SelectTrigger className="h-9 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="view">{PERM_LABEL.view}</SelectItem>
                              {!isFile && (
                                <SelectItem value="upload">{PERM_LABEL.upload}</SelectItem>
                              )}
                              <SelectItem value="edit">{PERM_LABEL.edit}</SelectItem>
                            </SelectContent>
                          </Select>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-destructive hover:bg-destructive/10"
                            disabled={busy}
                            aria-label="Отозвать доступ"
                            onClick={() => revoke(share)}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyMyShares() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-4">
      <div
        className={cn(
          "h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4",
          "ring-4 ring-primary/5"
        )}
      >
        <Users className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Пока ничем не делились</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Откройте файл или папку в «Мои файлы», нажмите «Поделиться…» и выберите
        члена семьи. Здесь появится всё общее.
      </p>
    </div>
  );
}
