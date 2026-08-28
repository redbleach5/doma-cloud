"use client";

import * as React from "react";
import { Trash2, HardDrive, Home, Settings, Shield, FolderTree, Users, Shuffle } from "lucide-react";
import type { CurrentUser } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { formatBytes } from "@/lib/cloud/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  user: CurrentUser;
  onNavigate?: () => void;
}

export function CloudSidebar({ user, onNavigate }: Props) {
  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-border/60 bg-sidebar/50 backdrop-blur-sm">
      <CloudSidebarContent user={user} onNavigate={onNavigate} />
    </aside>
  );
}

export function CloudSidebarContent({ user, onNavigate }: Props) {
  // IMPORTANT: use individual selectors (not destructuring of the whole
  // store object). In zustand v5, `const { view } = useCloudStore()`
  // subscribes to the ENTIRE state object, which means the component
  // re-renders on every store change AND — more critically — closures
  // captured in onClick handlers can become stale because the selector
  // identity changes. Using `useCloudStore((s) => s.view)` subscribes
  // only to the `view` slice, and `useCloudStore((s) => s.setView)`
  // returns a stable function reference (zustand guarantees this).
  const view = useCloudStore((s) => s.view);
  const setView = useCloudStore((s) => s.setView);
  const setPendingPreview = useCloudStore((s) => s.setPendingPreview);
  const [randomBusy, setRandomBusy] = React.useState(false);

  const go = React.useCallback(
    (target: "files" | "trash" | "shared" | "shared-by-me" | "settings" | "admin") => {
      setView(target);
      onNavigate?.();
    },
    [setView, onNavigate]
  );

  const openRandomMemory = React.useCallback(async () => {
    if (randomBusy) return;
    setRandomBusy(true);
    try {
      const { item } = await api.randomImage();
      if (!item) {
        toast.message("Пока нет фото", {
          description: "Загрузите пару снимков — и можно будет тянуть случайное из дома.",
        });
        return;
      }
      setView("files");
      setPendingPreview(item);
      onNavigate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выбрать фото");
    } finally {
      setRandomBusy(false);
    }
  }, [randomBusy, setView, setPendingPreview, onNavigate]);

  const usedPct =
    Number(user.usedBytes) / Math.max(1, Number(user.quotaBytes)) * 100;

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 px-2 pt-3 space-y-0.5">
        <SidebarItem
          icon={<Home className="h-4 w-4" />}
          label="Мои файлы"
          active={view === "files"}
          onClick={() => go("files")}
          testId="nav-my-files"
        />
        <SidebarItem
          icon={<Shuffle className="h-4 w-4" />}
          label="Случайное из дома"
          active={false}
          onClick={openRandomMemory}
          testId="nav-random-memory"
          disabled={randomBusy}
        />

        {/* Shared-folders section — Google-Drive-style */}
        <div className="pt-2.5 mt-2.5 border-t border-border/40">
          <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Общее
          </div>
          <SidebarItem
            icon={<FolderTree className="h-4 w-4" />}
            label="Поделились со мной"
            active={view === "shared"}
            onClick={() => go("shared")}
            testId="nav-shared-with-me"
          />
          <SidebarItem
            icon={<Users className="h-4 w-4" />}
            label="Мои общие"
            active={view === "shared-by-me"}
            onClick={() => go("shared-by-me")}
            testId="nav-shared-by-me"
          />
        </div>

        <SidebarItem
          icon={<Trash2 className="h-4 w-4" />}
          label="Корзина"
          active={view === "trash"}
          onClick={() => go("trash")}
        />

        <div className="pt-2.5 mt-2.5 border-t border-border/40">
          <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Аккаунт
          </div>
          <SidebarItem
            icon={<Settings className="h-4 w-4" />}
            label="Настройки"
            active={view === "settings"}
            onClick={() => go("settings")}
          />
          {user.role === "admin" && (
            <SidebarItem
              icon={<Shield className="h-4 w-4" />}
              label="Админ-панель"
              active={view === "admin"}
              onClick={() => go("admin")}
            />
          )}
        </div>
      </nav>

      <div className="p-3 mt-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="rounded-xl bg-card border border-border/60 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5" />
            <span>Хранилище</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                usedPct > 90 ? "bg-destructive" : "bg-primary"
              )}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{formatBytes(user.usedBytes)}</span>
            <span className="text-muted-foreground">{formatBytes(user.quotaBytes)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const SidebarItem = React.memo(function SidebarItem({
  icon,
  label,
  active,
  onClick,
  testId,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "relative w-full flex items-center gap-2.5 px-3 py-2 min-h-10 rounded-lg text-sm transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled && "opacity-60 pointer-events-none",
        active
          ? "bg-primary/10 text-primary font-medium shadow-sm"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary"
        />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
});
