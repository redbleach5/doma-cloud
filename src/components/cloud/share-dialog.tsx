"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Link2, Lock, Loader2, Check, Share2, Trash2, Flame, Eye, EyeOff, Users } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/cloud/format";
import { copyText, shareOrCopyUrl } from "@/lib/cloud/share-url";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/components/cloud/prompt-dialog";

interface Props {
  item: FileItem;
  onClose: () => void;
}

export function ShareDialog({ item, onClose }: Props) {
  // Folders: share with a user account only.
  // Files: two modes — share with family (default) OR public link.
  if (item.isDirectory) {
    return <UserShareDialog item={item} onClose={onClose} />;
  }
  return <FileShareCombinedDialog item={item} onClose={onClose} />;
}

function FileShareCombinedDialog({ item, onClose }: Props) {
  const [tab, setTab] = React.useState<"family" | "link">("family");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Share2 className="h-5 w-5" />
            <DialogTitle>Поделиться файлом</DialogTitle>
          </div>
          <DialogDescription className="truncate" title={item.name}>
            {item.name}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6 flex gap-1 border-b border-border/60">
          <TabButton
            active={tab === "family"}
            onClick={() => setTab("family")}
            icon={<Users className="h-3.5 w-3.5" />}
            testId="share-tab-family"
          >
            Семье
          </TabButton>
          <TabButton
            active={tab === "link"}
            onClick={() => setTab("link")}
            icon={<Link2 className="h-3.5 w-3.5" />}
            testId="share-tab-link"
          >
            Ссылка
          </TabButton>
        </div>

        {tab === "family" ? (
          <UserShareBody item={item} onClose={onClose} embedded />
        ) : (
          <FileLinkBody item={item} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-primary font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function FileLinkBody({ item }: { item: FileItem }) {
  const qc = useQueryClient();
  const [usePassword, setUsePassword] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [expiry, setExpiry] = React.useState("7d");
  const [maxViews, setMaxViews] = React.useState("");
  const [oneTimeUse, setOneTimeUse] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const { data: existingShares } = useQuery({
    queryKey: ["shares", item.id],
    queryFn: () => api.listShares(item.id),
  });

  const hasLink = (existingShares?.shares.length ?? 0) > 0;

  const createShare = async () => {
    setCreating(true);
    try {
      const expiresAt = computeExpiry(expiry);
      const share = await api.createShare(item.id, {
        password: usePassword ? password : undefined,
        expiresAt: expiresAt?.toISOString(),
        maxViews: maxViews ? (Number.isFinite(parseInt(maxViews, 10)) ? parseInt(maxViews, 10) : undefined) : undefined,
        oneTimeUse: oneTimeUse || undefined,
        label: label.trim() || undefined,
      });
      const fullUrl = window.location.origin + share.url;
      const verb = share.updated ? "обновлена" : "создана";
      const result = await shareOrCopyUrl(fullUrl, item.name);
      if (result === "shared") {
        toast.success(`Ссылка ${verb}`);
      } else if (result === "copied") {
        toast.success(`Ссылка ${verb} и скопирована`);
      } else if (result === "cancelled") {
        toast.success(`Ссылка ${verb}`, {
          description: "Откройте её ниже или нажмите «Поделиться».",
        });
      } else {
        toast.success(`Ссылка ${verb}`, {
          description: "Скопируйте её вручную из поля ниже (буфер обмена недоступен по HTTP).",
        });
      }
      qc.invalidateQueries({ queryKey: ["shares", item.id] });
      setPassword("");
      setMaxViews("");
      setOneTimeUse(false);
      setLabel("");
      setUsePassword(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать ссылку");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DialogBody className="space-y-3">
        {existingShares && existingShares.shares.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Текущая ссылка
            </div>
            {existingShares.shares.slice(0, 1).map((s) => (
              <ShareRow key={s.id} share={s} fileId={item.id} />
            ))}
          </div>
        )}

        <details className="group rounded-lg border border-border/60 bg-muted/15 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium flex items-center justify-between gap-2">
            <span>{hasLink ? "Изменить параметры" : "Параметры ссылки"}</span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              7 дней · без пароля
            </span>
            <span className="text-xs text-muted-foreground hidden group-open:inline">Скрыть</span>
          </summary>
          <div className="space-y-3 border-t border-border/50 px-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="label">Название (необязательно)</Label>
              <Input
                id="label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="например, «отпуск-2026»"
                className="h-10"
                maxLength={120}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="usePassword" className="flex items-center gap-2 cursor-pointer">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Защитить паролем
              </Label>
              <Switch
                id="usePassword"
                checked={usePassword}
                onCheckedChange={setUsePassword}
                data-testid="share-use-password"
              />
            </div>
            {usePassword && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Пароль</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="пароль"
                    className="h-10 pr-10"
                    data-testid="share-link-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-0.5 h-9 w-9"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="expiry">Срок</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="expiry" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1d">1 день</SelectItem>
                    <SelectItem value="7d">7 дней</SelectItem>
                    <SelectItem value="30d">30 дней</SelectItem>
                    <SelectItem value="never">Без срока</SelectItem>
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
                  placeholder="∞"
                  className="h-10"
                  disabled={oneTimeUse}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="oneTimeUse" className="flex items-center gap-2 cursor-pointer">
                <Flame className="h-4 w-4 text-amber-500" />
                <span className="text-sm">Одноразовая</span>
              </Label>
              <Switch
                id="oneTimeUse"
                checked={oneTimeUse}
                onCheckedChange={(v) => {
                  setOneTimeUse(v);
                  if (v) setMaxViews("");
                }}
              />
            </div>
          </div>
        </details>
      </DialogBody>

      <DialogFooter>
        <Button
          onClick={createShare}
          disabled={creating}
          className="w-full h-11 gap-2 sm:w-auto sm:min-w-44"
          data-testid="share-create-link"
        >
          {creating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {hasLink ? "Сохраняем…" : "Создаём…"}
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" />
              {hasLink ? "Обновить ссылку" : "Создать ссылку"}
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

interface UserShare {
  id: string;
  recipientId: string;
  recipientUsername: string;
  recipientDisplayName: string;
  permission: "view" | "upload" | "edit";
  createdAt: string;
}

function UserShareDialog({ item, onClose }: Props) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Users className="h-5 w-5" />
            <DialogTitle>Поделиться папкой</DialogTitle>
          </div>
          <DialogDescription className="truncate" title={item.name}>
            {item.name} · доступ для аккаунта семьи
          </DialogDescription>
        </DialogHeader>
        <UserShareBody item={item} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function UserShareBody({
  item,
  onClose,
  embedded = false,
}: Props & { embedded?: boolean }) {
  void onClose;
  const qc = useQueryClient();
  const [permission, setPermission] = React.useState<"view" | "upload" | "edit">("view");
  const [sharing, setSharing] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const { data: family, isLoading: loadingFamily } = useQuery({
    queryKey: ["family-users"],
    queryFn: () => api.listFamilyUsers(),
  });

  const { data: existingShares } = useQuery({
    queryKey: ["folder-shares", item.id],
    queryFn: () => api.listFolderShares(item.id),
  });

  const sharedByRecipientId = React.useMemo(() => {
    const map = new Map<string, UserShare>();
    for (const s of existingShares?.shares ?? []) {
      map.set(s.recipientId, s);
    }
    return map;
  }, [existingShares]);

  const notYetShared = React.useMemo(
    () => (family?.users ?? []).filter((u) => !sharedByRecipientId.has(u.id)),
    [family, sharedByRecipientId]
  );

  const fileOnlyPerms = !item.isDirectory;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folder-shares", item.id] });
    qc.invalidateQueries({ queryKey: ["my-shares"] });
    qc.invalidateQueries({ queryKey: ["shared-with-me"] });
  };

  const shareWithUsers = async (
    recipients: Array<{ id: string; username: string; displayName: string }>
  ) => {
    if (recipients.length === 0) {
      toast.error("Выберите, кому открыть доступ");
      return;
    }
    setSharing(true);
    try {
      const perm = fileOnlyPerms && permission === "upload" ? "view" : permission;
      let ok = 0;
      let fail = 0;
      for (const r of recipients) {
        try {
          await api.shareFolder(item.id, r.username, perm);
          ok++;
        } catch {
          fail++;
        }
      }
      if (ok > 0 && fail === 0) {
        toast.success(
          ok === 1
            ? `Открыто для ${recipients[0].displayName}`
            : ok === (family?.users.length ?? 0)
              ? "Открыто всей семье"
              : `Открыто для ${ok} человек`
        );
      } else if (ok > 0) {
        toast.success(`Открыто для ${ok}, не удалось: ${fail}`);
      } else {
        toast.error("Не удалось открыть доступ");
      }
      invalidate();
      setSelectedIds(new Set());
    } finally {
      setSharing(false);
    }
  };

  const shareSelected = () => {
    const recipients = (family?.users ?? []).filter((u) => selectedIds.has(u.id));
    return shareWithUsers(recipients);
  };

  const shareEveryone = () => {
    // Upsert for the whole household at the chosen permission.
    return shareWithUsers(family?.users ?? []);
  };

  const everyoneAlready =
    (family?.users.length ?? 0) > 0 && notYetShared.length === 0;

  return (
    <>
      <DialogBody className={embedded ? "space-y-3 pt-3" : "space-y-3"}>
        <div className="space-y-1.5">
          <Label>Права</Label>
          <Select
            value={permission}
            onValueChange={(v) => setPermission(v as "view" | "upload" | "edit")}
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">Просмотр</SelectItem>
              {!fileOnlyPerms && <SelectItem value="upload">Загрузка</SelectItem>}
              <SelectItem value="edit">Редактирование</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Семья
            </div>
            {(family?.users.length ?? 0) > 1 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline disabled:opacity-50"
                disabled={sharing}
                onClick={() => {
                  if (notYetShared.length === 0) {
                    setSelectedIds(new Set((family?.users ?? []).map((u) => u.id)));
                  } else {
                    setSelectedIds(new Set(notYetShared.map((u) => u.id)));
                  }
                }}
              >
                Выбрать всех
              </button>
            )}
          </div>

          {loadingFamily ? (
            <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка…
            </div>
          ) : !family?.users.length ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground text-center">
              Пока нет других аккаунтов в семье.
              Админ может добавить их в настройках.
            </div>
          ) : (
            <div className="border border-border/60 rounded-lg max-h-56 overflow-y-auto divide-y divide-border/40">
              {family.users.map((u) => {
                const existing = sharedByRecipientId.get(u.id);
                const checked = selectedIds.has(u.id);
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-2.5 px-3 py-2.5"
                  >
                    {!existing ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={`Выбрать ${u.displayName}`}
                        onClick={() => toggleSelected(u.id)}
                        className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          checked
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border bg-background"
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                        <Check className="h-3 w-3 text-primary" />
                      </div>
                    )}
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {u.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.displayName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {existing ? "уже открыто" : "нет доступа"}
                      </div>
                    </div>
                    {existing && (
                      <UserShareRow
                        share={existing}
                        nodeId={item.id}
                        isFile={!item.isDirectory}
                        compact
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter className="flex-col sm:flex-row gap-2">
        <Button
          variant="secondary"
          onClick={shareEveryone}
          disabled={sharing || !(family?.users.length)}
          className="w-full h-11 gap-2 sm:flex-1"
        >
          {sharing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Users className="h-4 w-4" />
          )}
          {everyoneAlready ? "Обновить всем" : "Всем в семье"}
        </Button>
        <Button
          onClick={shareSelected}
          disabled={sharing || selectedIds.size === 0}
          className="w-full h-11 gap-2 sm:flex-1"
          data-testid="share-open-selected"
        >
          {sharing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="h-4 w-4" />
          )}
          {selectedIds.size > 0
            ? `Открыть выбранным (${selectedIds.size})`
            : "Открыть выбранным"}
        </Button>
      </DialogFooter>
    </>
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
    label: string | null;
    expiresAt: string | null;
    maxViews: number | null;
    usedCount: number;
    hasPassword: boolean;
    oneTimeUse: boolean;
    createdAt: string;
  };
  fileId: string;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const fullUrl = typeof window !== "undefined" ? window.location.origin + share.url : share.url;
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    const ok = await copyText(fullUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Ссылка скопирована");
    } else {
      toast.error("Не удалось скопировать", {
        description: "Выделите ссылку длинным нажатием и скопируйте вручную.",
      });
    }
  };

  const nativeShare = async () => {
    const result = await shareOrCopyUrl(fullUrl, share.label ?? undefined);
    if (result === "shared") return;
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Ссылка скопирована");
    } else if (result !== "cancelled") {
      toast.error("Не удалось поделиться", {
        description: "Выделите ссылку длинным нажатием и скопируйте вручную.",
      });
    }
  };

  const revoke = async () => {
    const ok = await confirmDialog({
      title: "Отозвать ссылку?",
      description: "После этого никто не сможет открыть файл по этой ссылке. Действие необратимо.",
      confirmText: "Отозвать",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await api.revokeShare(fileId, share.token);
      toast.success("Ссылка отозвана");
      qc.invalidateQueries({ queryKey: ["shares", fileId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отозвать ссылку");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/60 p-2.5 bg-card">
      <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        {share.hasPassword ? (
          <Lock className="h-3.5 w-3.5 text-primary" />
        ) : share.oneTimeUse ? (
          <Flame className="h-3.5 w-3.5 text-amber-500" />
        ) : (
          <Link2 className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {share.label && (
          <div className="text-xs font-medium truncate">{share.label}</div>
        )}
        <input
          readOnly
          value={fullUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full text-xs font-mono bg-muted/40 border border-border/40 rounded-md px-2 py-1.5 break-all"
          aria-label="Ссылка для шаринга"
        />
        <div className="text-[11px] text-muted-foreground">
          {share.oneTimeUse && "одноразовая · "}
          {share.usedCount}
          {share.maxViews ? ` / ${share.maxViews}` : share.oneTimeUse ? " / 1" : ""} просм.
          {share.expiresAt && ` · до ${formatRelative(share.expiresAt)}`}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 shrink-0">
        {canNativeShare && (
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={nativeShare} aria-label="Поделиться">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={copy} aria-label="Копировать">
          {copied ? <Check className="h-3.5 w-3.5 text-chart-2" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 text-destructive hover:bg-destructive/10"
          onClick={revoke}
          disabled={revoking}
          aria-label="Отозвать ссылку"
          title="Отозвать ссылку"
        >
          {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
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

function UserShareRow({
  share,
  nodeId,
  isFile,
  compact = false,
}: {
  share: UserShare;
  nodeId: string;
  isFile?: boolean;
  /** Inline controls only (used inside the family member list). */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [revoking, setRevoking] = React.useState(false);
  const [updatingPerm, setUpdatingPerm] = React.useState(false);

  const changePermission = async (newPerm: "view" | "upload" | "edit") => {
    if (newPerm === share.permission) return;
    setUpdatingPerm(true);
    try {
      await api.updateFolderShare(nodeId, share.id, newPerm);
      toast.success("Права обновлены");
      qc.invalidateQueries({ queryKey: ["folder-shares", nodeId] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      qc.invalidateQueries({ queryKey: ["shared-with-me"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить права");
    } finally {
      setUpdatingPerm(false);
    }
  };

  const revoke = async () => {
    const ok = await confirmDialog({
      title: `Отозвать доступ у «${share.recipientDisplayName}»?`,
      description: isFile
        ? "Пользователь больше не увидит этот файл в разделе «Общие»."
        : "Пользователь больше не увидит эту папку в разделе «Общие».",
      confirmText: "Отозвать",
      cancelText: "Отмена",
      variant: "destructive",
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await api.updateFolderShare(nodeId, share.id, null);
      toast.success("Доступ отозван");
      qc.invalidateQueries({ queryKey: ["folder-shares", nodeId] });
      qc.invalidateQueries({ queryKey: ["my-shares"] });
      qc.invalidateQueries({ queryKey: ["shared-with-me"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отозвать");
    } finally {
      setRevoking(false);
    }
  };

  const selectPerm =
    isFile && share.permission === "upload" ? "view" : share.permission;

  const controls = (
    <div className="flex items-center gap-1.5 shrink-0">
      <Select
        value={selectPerm}
        onValueChange={(v: "view" | "upload" | "edit") => changePermission(v)}
        disabled={updatingPerm}
      >
        <SelectTrigger className="h-9 w-[7.5rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">Просмотр</SelectItem>
          {!isFile && <SelectItem value="upload">Загрузка</SelectItem>}
          <SelectItem value="edit">Редактирование</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="ghost"
        className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10"
        onClick={revoke}
        disabled={revoking}
        aria-label="Отозвать доступ"
        title="Отозвать доступ"
      >
        {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );

  if (compact) return controls;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border/60 p-2.5 bg-card">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
          {share.recipientDisplayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{share.recipientDisplayName}</div>
          <div className="text-[11px] text-muted-foreground truncate">@{share.recipientUsername}</div>
        </div>
      </div>
      {controls}
    </div>
  );
}
