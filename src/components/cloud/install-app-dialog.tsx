"use client";

import * as React from "react";
import { toast } from "sonner";
import { Download, Info } from "lucide-react";
import { useCloudStore } from "@/lib/cloud/store";
import { BRAND_SHORT } from "@/lib/cloud/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detectInstallPlatform,
  getInstallPromptEvent,
  markInstallHintEngaged,
  onInstallPromptAvailable,
  promptNativeInstall,
  registerInstallPromptListener,
  type InstallPlatform,
} from "@/lib/cloud/pwa-install";
import { cn } from "@/lib/utils";

/**
 * InstallAppDialog — step-by-step «Add to Home Screen» guide, auto-tuned to
 * the detected platform but switchable. Menu item names differ across
 * browsers/languages (web.dev warning), so instructions list the common
 * variants. On iOS `beforeinstallprompt` does not exist — hence manual
 * Safari steps; on Android/desktop a one-tap native prompt is offered when
 * the browser already fired `beforeinstallprompt`.
 */

type GuideTab = "apple" | "android" | "desktop";

const TABS: Array<{ id: GuideTab; label: string }> = [
  { id: "apple", label: "iPhone / iPad" },
  { id: "android", label: "Android" },
  { id: "desktop", label: "Компьютер" },
];

const STEPS: Record<GuideTab, Array<{ title: string; text: string }>> = {
  apple: [
    {
      title: "Нажмите «Поделиться»",
      text: "Квадрат со стрелкой вверх в нижней панели Safari (на iPad — справа от адресной строки).",
    },
    {
      title: "Выберите «На экран “Домой”»",
      text: "Пункт в списке действий меню «Поделиться».",
    },
    {
      title: "Нажмите «Добавить»",
      text: "Иконка Doma появится на главном экране рядом с приложениями.",
    },
  ],
  android: [
    {
      title: "Откройте меню браузера",
      text: "Три точки справа от адресной строки в Chrome.",
    },
    {
      title: "Выберите «Установить приложение»",
      text: "В некоторых версиях пункт называется «Добавить на главный экран».",
    },
    {
      title: "Подтвердите установку",
      text: "Иконка Doma появится на главном экране.",
    },
  ],
  desktop: [
    {
      title: "Chrome",
      text: "Значок установки в правой части адресной строки, либо меню ⋮ → «Трансляция, сохранение и отправка» → «Установить страницу как приложение».",
    },
    {
      title: "Edge",
      text: "Меню … → «Приложения» → «Установить этот сайт как приложение».",
    },
    {
      title: "Готово",
      text: "Doma откроется в собственном окне — без вкладок и адресной строки.",
    },
  ],
};

const NOTES: Record<GuideTab, string> = {
  apple:
    "На iPhone и iPad устанавливать на домашний экран умеет только Safari. Если Doma открыта в Chrome или Firefox — скопируйте адрес и вставьте его в Safari.",
  android:
    "Названия пунктов немного отличаются в разных браузерах: в Samsung Internet — «Добавить страницу в» → «На главный экран».",
  desktop:
    "Safari на Mac не умеет устанавливать сайты как приложения — используйте Chrome или Edge.",
};

function tabForPlatform(platform: InstallPlatform): GuideTab {
  if (platform === "android") return "android";
  if (platform === "desktop") return "desktop";
  return "apple";
}

export function InstallAppDialog() {
  const open = useCloudStore((s) => s.installDialogOpen);
  const setOpen = useCloudStore((s) => s.setInstallDialogOpen);

  const [tab, setTab] = React.useState<GuideTab>("apple");
  const [canPrompt, setCanPrompt] = React.useState(false);

  React.useEffect(() => {
    registerInstallPromptListener();
    return onInstallPromptAvailable(() => {
      setCanPrompt(getInstallPromptEvent() !== null);
    });
  }, []);

  // Re-detect the device each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(tabForPlatform(detectInstallPlatform()));
    setCanPrompt(getInstallPromptEvent() !== null);
  }, [open]);

  const nativeInstall = async () => {
    const outcome = await promptNativeInstall();
    if (outcome === "accepted") {
      markInstallHintEngaged();
      toast.success("Приложение установлено", {
        description: "Иконка Doma — на главном экране устройства.",
      });
      setOpen(false);
    }
    // "dismissed" → keep the dialog open, manual steps are right above.
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="install-app-dialog">
        <DialogHeader>
          <DialogTitle>Установить {BRAND_SHORT} как приложение</DialogTitle>
          <DialogDescription>
            Иконка на главном экране, открытие в отдельном окне — без адресной строки.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Platform switcher — preselected by detection, user can correct */}
          <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Платформа">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                data-testid={`install-app-tab-${t.id}`}
                className={cn(
                  "rounded-lg border px-2 py-2 text-xs font-medium transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  tab === t.id
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ol className="space-y-3">
            {STEPS[tab].map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-snug">{step.title}</div>
                  <div className="text-xs leading-snug text-muted-foreground">{step.text}</div>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-snug text-muted-foreground">{NOTES[tab]}</p>
          </div>
        </DialogBody>

        <DialogFooter>
          {tab !== "apple" && canPrompt && (
            <Button onClick={nativeInstall} className="gap-1.5" data-testid="install-app-dialog-cta">
              <Download className="h-4 w-4" />
              Установить приложение
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Понятно
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}