"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Link2, Lock, Loader2, Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/cloud/format";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Props {
  item: FileItem;
  onClose: () => void;
}

export function ShareDialog({ item, onClose }: Props) {
  const qc = useQueryClient();
  const [usePassword, setUsePassword] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [expiry, setExpiry] = React.useState("7d");
  const [maxViews, setMaxViews] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const { data: existingShares } = useQuery({
    queryKey: ["shares", item.id],
    queryFn: () => api.listShares(item.id),
  });

  const createShare = async () => {
    setCreating(true);
    try {
      const expiresAt = computeExpiry(expiry);
      const share = await api.createShare(item.id, {
        password: usePassword ? password : undefined,
        expiresAt: expiresAt?.toISOString(),
        maxViews: maxViews ? parseInt(maxViews, 10) : undefined,
      });
      const fullUrl = window.location.origin + share.url;
      await navigator.clipboard.writeText(fullUrl).catch(() => undefined);
      toast.success("Ссылка создана и скопирована");
      qc.invalidateQueries({ queryKey: ["shares", item.id] });
      setPassword("");
      setMaxViews("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Share2 className="h-5 w-5" />
            <DialogTitle>Поделиться файлом</DialogTitle>
          </div>
          <DialogDescription className="truncate" title={item.name}>
            {item.name}
          </DialogDescription>
        </DialogHeader>

        {/* Existing shares */}
        {existingShares && existingShares.shares.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Активные ссылки
            </div>
            {existingShares.shares.map((s) => (
              <ShareRow key={s.id} share={s} fileId={item.id} />
            ))}
          </div>
        )}

        {/* New share form */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="usePassword" className="flex items-center gap-2 cursor-pointer">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Защитить паролем
            </Label>
            <Switch id="usePassword" checked={usePassword} onCheckedChange={setUsePassword} />
          </div>
          {usePassword && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="например, letmein2026"
                className="h-10"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="expiry">Срок действия</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="expiry" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">1 день</SelectItem>
                  <SelectItem value="7d">7 дней</SelectItem>
                  <SelectItem value="30d">30 дней</SelectItem>
                  <SelectItem value="never">Без ограничения</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxViews">Макс. просмотров</Label>
              <Input
                id="maxViews"
                type="number"
                min={1}
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                placeholder="без лимита"
                className="h-10"
              />
            </div>
          </div>

          <Button onClick={createShare} disabled={creating} className="w-full h-11 gap-2">
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Создаём…
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4" />
                Создать ссылку
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareRow({
  share,
  fileId,
}: {
  share: {
    id: string;
    token: string;
    url: string;
    expiresAt: string | null;
    maxViews: number | null;
    usedCount: number;
    hasPassword: boolean;
    createdAt: string;
  };
  fileId: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const fullUrl = typeof window !== "undefined" ? window.location.origin + share.url : share.url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 p-2.5 bg-card">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        {share.hasPassword ? (
          <Lock className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Link2 className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono truncate">{fullUrl}</div>
        <div className="text-[10px] text-muted-foreground">
          {share.usedCount}
          {share.maxViews ? ` / ${share.maxViews}` : ""} просм.
          {share.expiresAt && ` · до ${formatRelative(share.expiresAt)}`}
        </div>
      </div>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copy} aria-label="Копировать">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function computeExpiry(value: string): Date | null {
  if (value === "never") return null;
  const now = new Date();
  switch (value) {
    case "1d": return new Date(now.getTime() + 1 * 86400_000);
    case "7d": return new Date(now.getTime() + 7 * 86400_000);
    case "30d": return new Date(now.getTime() + 30 * 86400_000);
    default: return null;
  }
}
