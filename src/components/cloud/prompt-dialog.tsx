"use client";

import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * PromptDialog — стилизованная замена window.prompt().
 *
 * Принимает title, описание, defaultValue и возвращает string | null
 * (null = отменено). Использует управляемый input с валидацией длины.
 *
 * Пример:
 *   const name = await promptDialog({ title: "Новая папка", ... });
 *   if (name) await createFolder(name);
 */
export interface PromptOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  label?: string;
  confirmText?: string;
  cancelText?: string;
  minLength?: number;
  maxLength?: number;
  /** Запретить пустой результат (trim). По умолчанию true. */
  required?: boolean;
}

let openPrompt: (opts: PromptOptions) => Promise<string | null> = () =>
  Promise.resolve(null);

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return openPrompt(opts);
}

/** Глобальный провайдер — монтируется один раз в layout. */
export function PromptDialogProvider() {
  const [state, setState] = React.useState<{
    opts: PromptOptions;
    resolve: (v: string | null) => void;
  } | null>(null);

  React.useEffect(() => {
    openPrompt = (opts) =>
      new Promise<string | null>((resolve) => {
        setState({ opts, resolve });
      });
    return () => {
      openPrompt = () => Promise.resolve(null);
    };
  }, []);

  const close = (value: string | null) => {
    state?.resolve(value);
    setState(null);
  };

  if (!state) return null;

  return (
    <PromptDialogInner
      opts={state.opts}
      onCancel={() => close(null)}
      onConfirm={(v) => close(v)}
    />
  );
}

function PromptDialogInner({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: PromptOptions;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const {
    title,
    description,
    defaultValue = "",
    placeholder,
    label,
    confirmText = "ОК",
    cancelText = "Отмена",
    minLength = 1,
    maxLength = 255,
    required = true,
  } = opts;

  const [value, setValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Autofocus + select-all при открытии — пользователь сразу может печатать поверх.
  React.useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  // Enter подтверждает, Escape отменяет.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (required && trimmed.length < minLength) return;
    onConfirm(trimmed);
  };

  const tooShort = required && value.trim().length < minLength;
  const tooLong = value.length > maxLength;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogBody className="space-y-3">
            {label && <Label htmlFor="prompt-input">{label}</Label>}
            <Input
              id="prompt-input"
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              minLength={minLength}
              maxLength={maxLength}
              aria-invalid={tooShort || tooLong}
              className="h-11"
            />
            {(tooShort || tooLong) && (
              <p className="text-xs text-destructive">
                {tooShort
                  ? `Минимум ${minLength} символ(а/ов)`
                  : `Максимум ${maxLength} символов`}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">
              {cancelText}
            </Button>
            <Button type="submit" disabled={tooShort || tooLong} className="flex-1 sm:flex-none">
              {confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ConfirmDialog — стилизованная замена window.confirm().
 *
 * Пример:
 *   const ok = await confirmDialog({ title: "Удалить?", description: "..." });
 *   if (ok) await purge();
 */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

let openConfirm: (opts: ConfirmOptions) => Promise<boolean> = () =>
  Promise.resolve(false);

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return openConfirm(opts);
}

/** Глобальный провайдер — монтируется один раз в layout. */
export function ConfirmDialogProvider() {
  const [state, setState] = React.useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  React.useEffect(() => {
    openConfirm = (opts) =>
      new Promise<boolean>((resolve) => {
        setState({ opts, resolve });
      });
    return () => {
      openConfirm = () => Promise.resolve(false);
    };
  }, []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  if (!state) return null;

  const {
    title,
    description,
    confirmText = "Подтвердить",
    cancelText = "Отмена",
    variant = "default",
  } = state.opts;

  return (
    <Dialog open onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => close(false)}>
            {cancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Комбинированный провайдер — монтируется в layout одним компонентом. */
export function DialogProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <PromptDialogProvider />
      <ConfirmDialogProvider />
    </>
  );
}

// Loader2 реэкспортируем, чтобы не тащить лишний import в потребителях
export { Loader2 };
