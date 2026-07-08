"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Cloud, Trash2, Upload, HardDrive, Home, Settings, Shield, FolderClosed } from "lucide-react";
import type { CurrentUser } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { formatBytes } from "@/lib/cloud/format";
import { cn } from "@/lib/utils";

interface Props {
  user: CurrentUser;
  onUploadClick: () => void;
  onNavigate?: () => void;
}

export function CloudSidebar({ user, onUploadClick, onNavigate }: Props) {
  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-border/60 bg-sidebar/50 backdrop-blur-sm">
      <CloudSidebarContent user={user} onUploadClick={onUploadClick} onNavigate={onNavigate} />
    </aside>
  );
}

export function CloudSidebarContent({ user, onUploadClick, onNavigate }: Props) {
  const { view, setView, reset } = useCloudStore();

  const go = (target: "files" | "trash" | "settings" | "admin") => {
    if (target === "files") reset();
    else setView(target);
    onNavigate?.();
  };

  const usedPct =
    Number(user.usedBytes) / Math.max(1, Number(user.quotaBytes)) * 100;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 flex items-center px-4 border-b border-border/60">
        <button onClick={() => go("files")} className="flex items-center gap-2 group">
          <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center ring-2 ring-primary/5 group-hover:ring-primary/20 transition">
            <Cloud className="h-5 w-5 text-primary" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Doma</span>
        </button>
      </div>

      <div className="p-3">
        <Button
          onClick={() => {
            onUploadClick();
            onNavigate?.();
          }}
          className="w-full gap-2 shadow-sm"
          size="sm"
          disabled={view !== "files"}
        >
          <Upload className="h-4 w-4" />
          Загрузить
        </Button>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        <SidebarItem
          icon={<Home className="h-4 w-4" />}
          label="Мои файлы"
          active={view === "files"}
          onClick={() => go("files")}
        />
        <SidebarItem
          icon={<Trash2 className="h-4 w-4" />}
          label="Корзина"
          active={view === "trash"}
          onClick={() => go("trash")}
        />

        <div className="pt-3 mt-3 border-t border-border/40">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
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

      <div className="p-3 mt-auto">
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

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
        active
          ? "bg-primary/10 text-primary font-medium shadow-sm"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

void FolderClosed;
