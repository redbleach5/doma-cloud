"use client";

import * as React from "react";
import { Home, FolderTree, Trash2, MoreHorizontal, Users, Settings, Shield, Shuffle } from "lucide-react";
import type { CurrentUser } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import { useCloudStore, type View } from "@/lib/cloud/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";

interface Props {
  user: CurrentUser;
}

const PRIMARY: Array<{ view: View; label: string; icon: React.ReactNode }> = [
  { view: "files", label: "Файлы", icon: <Home className="h-5 w-5" /> },
  { view: "shared", label: "Общие", icon: <FolderTree className="h-5 w-5" /> },
  { view: "trash", label: "Корзина", icon: <Trash2 className="h-5 w-5" /> },
];

const MORE_VIEWS: View[] = ["shared-by-me", "settings", "admin"];

export function MobileBottomNav({ user }: Props) {
  const view = useCloudStore((s) => s.view);
  const setView = useCloudStore((s) => s.setView);
  const setPendingPreview = useCloudStore((s) => s.setPendingPreview);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [randomBusy, setRandomBusy] = React.useState(false);

  const moreActive = MORE_VIEWS.includes(view);

  const go = (target: View) => {
    setView(target);
    setMoreOpen(false);
  };

  const openRandomMemory = async () => {
    if (randomBusy) return;
    setRandomBusy(true);
    try {
      const { item } = await api.randomImage();
      if (!item) {
        toast.message("Пока нет фото", {
          description: "Загрузите фотографии — и можно будет показать случайную.",
        });
        return;
      }
      setView("files");
      setPendingPreview(item);
      setMoreOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выбрать фото");
    } finally {
      setRandomBusy(false);
    }
  };

  return (
    <>
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Основная навигация"
      >
        <div className="grid grid-cols-4 h-14">
          {PRIMARY.map((tab) => {
            const active = view === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                onClick={() => go(tab.view)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 min-h-11 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 min-h-11 text-[10px] font-medium transition-colors",
              moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            aria-current={moreActive ? "page" : undefined}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>Ещё</span>
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>Ещё</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-1 pb-4">
            <MoreItem
              icon={<Shuffle className="h-4 w-4" />}
              label="Случайное фото"
              active={false}
              onClick={openRandomMemory}
              disabled={randomBusy}
            />
            <MoreItem
              icon={<Users className="h-4 w-4" />}
              label="Мои общие"
              active={view === "shared-by-me"}
              onClick={() => go("shared-by-me")}
            />
            <MoreItem
              icon={<Settings className="h-4 w-4" />}
              label="Настройки"
              active={view === "settings"}
              onClick={() => go("settings")}
            />
            {user.role === "admin" && (
              <MoreItem
                icon={<Shield className="h-4 w-4" />}
                label="Админ-панель"
                active={view === "admin"}
                onClick={() => go("admin")}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MoreItem({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 min-h-11 px-3 rounded-lg text-sm transition-colors",
        disabled && "opacity-60 pointer-events-none",
        active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
