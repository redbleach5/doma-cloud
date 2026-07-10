"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Cloud, LogOut, Upload, Menu } from "lucide-react";
import type { CurrentUser } from "@/lib/cloud/api";
import { useCloudStore } from "@/lib/cloud/store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/cloud/api";
import { formatBytes } from "@/lib/cloud/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CloudSidebarContent } from "@/components/cloud/cloud-sidebar";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  user: CurrentUser;
  onLogout: () => void;
  onUploadClick: () => void;
}

export function CloudHeader({ user, onLogout, onUploadClick }: Props) {
  // Individual selectors — see cloud-sidebar.tsx for why this matters.
  const view = useCloudStore((s) => s.view);
  const setView = useCloudStore((s) => s.setView);
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    refetchInterval: 30_000,
  });
  const freshUser = meData?.user ?? user;
  const usedPct =
    Number(freshUser.usedBytes) / Math.max(1, Number(freshUser.quotaBytes)) * 100;

  const handleLogout = async () => {
    try {
      await api.logout();
      qc.clear();
      onLogout();
      toast.success("Вы вышли");
    } catch {
      toast.error("Не удалось выйти");
    }
  };

  const initials = freshUser.displayName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border/60 bg-background/85 backdrop-blur-md flex items-center px-3 gap-2">
      {/* Mobile sidebar toggle */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Меню">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Меню</SheetTitle>
          </SheetHeader>
          <CloudSidebarContent
            user={freshUser}
            onUploadClick={() => {
              onUploadClick();
              setMobileOpen(false);
            }}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <button
        onClick={() => setView("files")}
        className="flex items-center gap-2 group"
        aria-label="Doma — на главную"
      >
        <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center ring-2 ring-primary/5 group-hover:ring-primary/20 transition">
          <Cloud className="h-5 w-5 text-primary" />
        </div>
        <span className="font-semibold text-lg tracking-tight hidden sm:block">Doma</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {view === "files" && (
          <Button
            size="sm"
            onClick={onUploadClick}
            className="gap-1.5 shadow-sm"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Загрузить</span>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full hover:bg-muted/60 p-1 pr-2 transition" aria-label="Аккаунт">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-medium">
                  {initials || "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:block text-sm font-medium max-w-32 truncate">
                {freshUser.displayName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium truncate">{freshUser.displayName}</span>
                <span className="text-xs text-muted-foreground">@{freshUser.username}</span>
                {freshUser.role === "admin" && (
                  <span className="text-[10px] uppercase tracking-wide text-primary font-semibold mt-0.5">
                    Администратор
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground mb-1">
                <span>Место</span>
                <span className="text-foreground">
                  {formatBytes(freshUser.usedBytes)} / {formatBytes(freshUser.quotaBytes)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, usedPct)}%` }}
                />
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
