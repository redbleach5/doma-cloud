"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { LogOut, Menu } from "lucide-react";
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
import { DomaBrand } from "@/components/cloud/doma-brand";
import { toast } from "sonner";
import { timeGreeting } from "@/lib/cloud/time-greeting";
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
}

function DayGreeting({ displayName }: { displayName: string }) {
  // Recompute on mount / hour boundary without a ticking clock.
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const g = timeGreeting(now, displayName);
  return (
    <div className="min-w-0 hidden sm:flex flex-col justify-center leading-tight ml-1 mr-2">
      <span className="text-sm text-muted-foreground truncate" data-testid="day-greeting">
        {g.line}
      </span>
    </div>
  );
}

export function CloudHeader({ user, onLogout }: Props) {
  // Individual zustand selectors (see cloud-sidebar.tsx).
  const setView = useCloudStore((s) => s.setView);
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    // 60s — свежая квота без лишних запросов.
    refetchInterval: 60_000,
    // На window focus не рефетчим: cloud-app.tsx уже инвалидрует ["me"].
    refetchOnWindowFocus: false,
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
    <header
      className="sticky top-0 z-30 min-h-14 border-b border-border/60 bg-background md:bg-background/85 md:backdrop-blur-md flex items-center gap-2 doma-safe-landscape"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
      }}
    >
      {/* Mobile sidebar toggle */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Меню">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-72 p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Меню</SheetTitle>
          </SheetHeader>
          <CloudSidebarContent
            user={freshUser}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <DomaBrand
        onClick={() => {
          setView("files");
          setMobileOpen(false);
        }}
      />

      <DayGreeting displayName={freshUser.displayName} />

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="rounded-full hover:bg-muted/60 p-1 pr-2 h-auto gap-2" aria-label="Аккаунт">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-medium">
                  {initials || "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:block text-sm font-medium max-w-32 truncate">
                {freshUser.displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium truncate">{freshUser.displayName}</span>
                <span className="text-xs text-muted-foreground">@{freshUser.username}</span>
                {freshUser.role === "admin" && (
                  <span className="text-[11px] uppercase tracking-wide text-primary font-semibold mt-0.5">
                    Администратор
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              <span className="tabular-nums text-foreground">
                {formatBytes(freshUser.usedBytes)}
              </span>
              {" / "}
              {formatBytes(freshUser.quotaBytes)}
              <span className="ml-1.5 text-[11px] tabular-nums">
                ({Math.round(usedPct)}%)
              </span>
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
