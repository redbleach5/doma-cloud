"use client";

import * as React from "react";
import { toast } from "sonner";
import { Smartphone, X } from "lucide-react";
import { useCloudStore } from "@/lib/cloud/store";
import { BRAND_SHORT } from "@/lib/cloud/brand";
import { Button } from "@/components/ui/button";
import {
  getInstallHintState,
  getInstallPromptEvent,
  markInstallHintEngaged,
  onInstallPromptAvailable,
  promptNativeInstall,
  registerInstallPromptListener,
  snoozeInstallHint,
} from "@/lib/cloud/pwa-install";

/**
 * InstallHint — one-time, dismissible «install the app» card for phones.
 * Unobtrusive by design: mobile devices only, not while the app is already
 * installed, no earlier than 6 s after mount (let the page settle), hidden
 * during active uploads, and the dismissal is remembered (30 days; a year
 * if the user engaged with the guide). Sits bottom-left, above the mobile
 * bottom nav — the bottom-right corner belongs to BirthdayGreeting.
 */
export function InstallHint() {
  const uploadVisible = useCloudStore((s) => s.uploadVisible);
  const setInstallDialogOpen = useCloudStore((s) => s.setInstallDialogOpen);
  const [show, setShow] = React.useState(false);
  const [canPrompt, setCanPrompt] = React.useState(false);

  React.useEffect(() => {
    registerInstallPromptListener();
    const unsub = onInstallPromptAvailable(() => {
      setCanPrompt(getInstallPromptEvent() !== null);
    });
    // Let the page settle before drawing any attention.
    const timer = window.setTimeout(() => {
      const state = getInstallHintState();
      setCanPrompt(state.canNativePrompt);
      if (state.shouldShow) setShow(true);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  const dismiss = React.useCallback(() => {
    snoozeInstallHint();
    setShow(false);
  }, []);

  const openGuide = React.useCallback(() => {
    markInstallHintEngaged();
    setShow(false);
    setInstallDialogOpen(true);
  }, [setInstallDialogOpen]);

  const nativeInstall = async () => {
    const outcome = await promptNativeInstall();
    if (outcome === "accepted") {
      markInstallHintEngaged();
      setShow(false);
      toast.success("Приложение установлено", {
        description: "Иконка Doma — на главном экране устройства.",
      });
    } else if (outcome === "dismissed") {
      // The native prompt didn't convince — fall back to the manual guide.
      openGuide();
    }
  };

  if (!show || uploadVisible) return null;

  return (
    <div
      data-testid="install-hint"
      className="fixed bottom-[max(5rem,calc(5rem+env(safe-area-inset-bottom)))] left-4 z-40 max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-4 fade-in duration-500 sm:max-w-xs"
    >
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-3.5 shadow-2xl shadow-primary/10 backdrop-blur-md">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug">
              Установите {BRAND_SHORT} как приложение
            </div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Иконка на главном экране, открытие без адресной строки.
            </div>
            <div className="mt-2.5">
              {canPrompt ? (
                <Button
                  size="sm"
                  onClick={nativeInstall}
                  className="h-8 gap-1.5"
                  data-testid="install-hint-cta"
                >
                  Установить
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openGuide}
                  className="h-8"
                  data-testid="install-hint-cta"
                >
                  Как установить
                </Button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Скрыть подсказку"
            data-testid="install-hint-dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}