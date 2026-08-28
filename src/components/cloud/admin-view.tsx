"use client";

import * as React from "react";
import { api, type CurrentUser, type AdminUser, type SystemSettings, type DiskInfo } from "@/lib/cloud/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users, BarChart3, Settings as SettingsIcon, Shield, Plus, Edit2,
  KeyRound, Trash2, Loader2, HardDrive, Activity, Crown, Save,
  Database, FolderCheck, AlertTriangle, RefreshCw, CheckCircle2,
} from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";
import { birthdayDateInputValue, toBirthdayIso } from "@/lib/cloud/birthday";
import { plural } from "@/lib/cloud/plural";
import { BRAND_NAME, BRAND_SHORT } from "@/lib/cloud/brand";

interface Props {
  currentUser: CurrentUser;
  onUserUpdated: (u: CurrentUser) => void;
}

export function AdminView({ currentUser, onUserUpdated }: Props) {
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-24">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Админ-панель</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Управление пользователями, квотами и системными настройками «{BRAND_NAME}».
      </p>

      <Tabs defaultValue="users">
        <TabsList className="grid w-full grid-cols-4 max-w-md">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Пользователи</span>
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Статистика</span>
          </TabsTrigger>
          <TabsTrigger value="storage" className="gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Диски</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <SettingsIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Система</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersTab currentUser={currentUser} onUserUpdated={onUserUpdated} />
        </TabsContent>
        <TabsContent value="stats" className="mt-4">
          <StatsTab />
        </TabsContent>
        <TabsContent value="storage" className="mt-4">
          <StorageTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SystemSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============= Users Tab =============

function UsersTab({ currentUser, onUserUpdated }: { currentUser: CurrentUser; onUserUpdated?: (u: CurrentUser) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.adminListUsers(),
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<AdminUser | null>(null);
  const [resetUser, setResetUser] = React.useState<AdminUser | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Загрузка пользователей…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Пользователи</h2>
          <p className="text-sm text-muted-foreground">
            {data.users.length} {plural(data.users.length, "пользователь", "пользователя", "пользователей")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </div>

      <Card className="border-border/40 overflow-hidden">
        <div className="divide-y divide-border/30">
          {data.users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUser.id}
              onEdit={() => setEditUser(u)}
              onResetPassword={() => setResetUser(u)}
              onDeleted={refresh}
            />
          ))}
        </div>
      </Card>

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}

      {editUser && (
        <EditUserDialog
          user={editUser}
          isSelf={editUser.id === currentUser.id}
          onClose={() => setEditUser(null)}
          onSaved={(updated) => {
            setEditUser(null);
            refresh();
            // If the admin edited their own profile, propagate the change
            // up to FileBrowser so the header/sidebar update immediately
            // instead of waiting for the next 30s /api/me poll.
            if (updated && updated.id === currentUser.id && onUserUpdated) {
              onUserUpdated({
                ...currentUser,
                displayName: updated.displayName,
                role: updated.role,
                quotaBytes: updated.quotaBytes,
                usedBytes: updated.usedBytes,
              });
            }
          }}
        />
      )}

      {resetUser && (
        <ResetPasswordDialog
          user={resetUser}
          onClose={() => setResetUser(null)}
          onDone={() => setResetUser(null)}
        />
      )}
    </div>
  );
}

function UserRow({
  user, isSelf, onEdit, onResetPassword, onDeleted,
}: {
  user: AdminUser;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const usedPct = Number(user.usedBytes) / Math.max(1, Number(user.quotaBytes)) * 100;

  const handleDelete = async () => {
    try {
      await api.adminDeleteUser(user.id);
      toast.success(`Пользователь «${user.displayName}» удалён`);
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  return (
    <div className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
        {user.displayName.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{user.displayName}</span>
          {user.role === "admin" && (
            <Badge variant="secondary" className="gap-1 text-[10px] py-0 px-1.5">
              <Crown className="h-2.5 w-2.5" />
              Админ
            </Badge>
          )}
          {isSelf && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              Вы
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 max-w-32 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${usedPct > 90 ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatBytes(user.usedBytes)} / {formatBytes(user.quotaBytes)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onEdit} aria-label="Редактировать">
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onResetPassword} aria-label="Сбросить пароль">
          <KeyRound className="h-3.5 w-3.5" />
        </Button>
        {!isSelf && (
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmDelete(true)}
            aria-label="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {confirmDelete && (
        <Dialog open onOpenChange={(o) => !o && setConfirmDelete(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-destructive">Удалить пользователя?</DialogTitle>
              <DialogDescription>
                Будут безвозвратно удалены все файлы и данные пользователя «{user.displayName}».
                Это действие нельзя отменить.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Отмена
              </Button>
              <Button variant="destructive" onClick={handleDelete} className="gap-1.5">
                <Trash2 className="h-4 w-4" />
                Удалить навсегда
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"admin" | "user">("user");
  const [quotaGB, setQuotaGB] = React.useState("50");
  const [saving, setSaving] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const quotaBytes = BigInt(parseFloat(quotaGB) * 1024 * 1024 * 1024).toString();
      await api.adminCreateUser({
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        password,
        role,
        quotaBytes,
      });
      toast.success(`Пользователь «${username}» создан`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый пользователь</DialogTitle>
          <DialogDescription>Создайте аккаунт для члена семьи</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-username">Логин</Label>
            <Input
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9._\-]+"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-displayName">Отображаемое имя</Label>
            <Input
              id="new-displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={username || "например, Мама"}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Пароль</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "user")}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quota">Квота (ГБ)</Label>
              <Input
                id="quota"
                type="number"
                min="1"
                step="1"
                value={quotaGB}
                onChange={(e) => setQuotaGB(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <Button type="submit" disabled={saving} className="w-full h-11 gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Создать
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, isSelf: _isSelf, onClose, onSaved }: { user: AdminUser; isSelf: boolean; onClose: () => void; onSaved: (updated: AdminUser) => void }) {
  const [displayName, setDisplayName] = React.useState(user.displayName);
  const [role, setRole] = React.useState<"admin" | "user">(user.role as "admin" | "user");
  const [quotaGB, setQuotaGB] = React.useState(() => {
    const gb = Number(user.quotaBytes) / (1024 * 1024 * 1024);
    return Number.isFinite(gb) ? String(Math.round(gb * 100) / 100) : "50";
  });
  const [birthday, setBirthday] = React.useState(birthdayDateInputValue(user.birthday));
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const quotaBytes = BigInt(Math.round(parseFloat(quotaGB) * 1024 * 1024 * 1024)).toString();
      const birthdayIso = birthday ? toBirthdayIso(birthday) : null;
      const { user: updated } = await api.adminUpdateUser(user.id, {
        displayName: displayName.trim(),
        role,
        quotaBytes,
        birthday: birthdayIso,
      });
      toast.success("Пользователь обновлён");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать: {user.displayName}</DialogTitle>
          <DialogDescription>@{user.username}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Отображаемое имя</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "user")}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Пользователь</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Квота (ГБ)</Label>
              <Input
                type="number"
                min="1"
                step="0.1"
                value={quotaGB}
                onChange={(e) => setQuotaGB(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>День рождения</Label>
            <Input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="h-11"
            />
          </div>
          <Button onClick={save} disabled={saving} className="w-full gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [newPassword, setNewPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const reset = async () => {
    if (newPassword.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    setSaving(true);
    try {
      await api.adminResetPassword(user.id, newPassword);
      toast.success("Пароль сброшен");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сбросить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Сбросить пароль</DialogTitle>
          <DialogDescription>
            Установите новый пароль для «{user.displayName}» (@{user.username}).
            Старый пароль перестанет работать.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Новый пароль</Label>
            <Input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              className="h-11 font-mono"
              placeholder="минимум 6 символов"
            />
          </div>
          <Button onClick={() => {
            // Cryptographically secure password — Math.random() is NOT
            // secure and should never be used for credentials. We pull 6
            // random bytes (48 bits of entropy) and base36-encode them.
            const bytes = new Uint8Array(6);
            crypto.getRandomValues(bytes);
            const pwd = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
            setNewPassword(pwd);
          }} variant="outline" size="sm">
            Сгенерировать случайный
          </Button>
          <Button onClick={reset} disabled={saving} className="w-full gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Сбросить пароль
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============= Stats Tab =============

function StatsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.adminGetStats(),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Загрузка статистики…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* User stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Всего пользователей"
          value={String(data.users.total)}
          color="text-primary"
        />
        <StatCard
          icon={<Crown className="h-5 w-5" />}
          label="Администраторов"
          value={String(data.users.admins)}
          color="text-warning"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Входили хоть раз"
          value={String(data.users.active)}
          color="text-success"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Ни разу не входили"
          value={String(data.users.neverLoggedIn)}
          color="text-muted-foreground"
        />
      </div>

      {/* Storage stats */}
      <Card className="border-border/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Хранилище</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatRow label="Использовано" value={formatBytes(data.storage.usedBytes)} />
          <StatRow label="В корзине" value={formatBytes(data.storage.trashBytes)} />
          <StatRow label="Суммарная квота" value={formatBytes(data.storage.totalQuotaBytes)} />
          <StatRow label="Файлов" value={String(data.storage.fileCount)} />
          <StatRow label="В корзине" value={`${data.storage.trashCount} ${plural(data.storage.trashCount, "файл", "файла", "файлов")}`} />
          <StatRow label="Активных ссылок" value={String(data.storage.sharesCount)} />
        </CardContent>
      </Card>

      {/* Disk space (if available) */}
      {data.disk.totalBytes != null && (
        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">Диск</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatRow label="Всего" value={formatBytes(data.disk.totalBytes ?? 0)} />
            <StatRow label="Занято" value={formatBytes(data.disk.usedBytes ?? 0)} />
            <StatRow label="Свободно" value={formatBytes(data.disk.freeBytes ?? 0)} />
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{
                  width: `${Math.min(100, ((data.disk.usedBytes ?? 0) / Math.max(1, data.disk.totalBytes ?? 1)) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-4">
        <div className={`${color ?? "text-muted-foreground"} mb-2`}>{icon}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ============= Storage Tab =============

function StorageTab() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "storage"],
    queryFn: () => api.adminGetStorage(),
  });

  const [customPath, setCustomPath] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirmSwitch, setConfirmSwitch] = React.useState<{ path: string; isCustom: boolean } | null>(null);

  React.useEffect(() => {
    if (data?.dbConfiguredRoot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomPath(data.dbConfiguredRoot);
    } else if (data?.localRoot) {
      setCustomPath(data.localRoot);
    }
  }, [data]);

  const applyRoot = async (path: string | null) => {
    setSaving(true);
    try {
      await api.adminSetStorageRoot(path);
      await qc.invalidateQueries({ queryKey: ["admin", "storage"] });
      await qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.success(path ? "Хранилище переключено" : "Путь сброшен к env-умолчанию");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось изменить путь");
    } finally {
      setSaving(false);
      setConfirmSwitch(null);
    }
  };

  const onPickPath = (path: string) => {
    if (!data) return;
    // If the picked path is already the active root, no-op.
    if (path === data.localRoot) {
      toast.info("Этот путь уже активен");
      return;
    }
    setConfirmSwitch({ path, isCustom: false });
  };

  /** Prefer a dedicated subfolder on removable/media mounts. */
  const storagePathForMount = (mount: string) => {
    // Windows drive letter (e.g. "D:") → dedicated subfolder on the drive.
    if (/^[A-Za-z]:$/.test(mount)) return `${mount}\\doma-storage`;
    if (
      mount.startsWith("/Volumes/") ||
      mount.startsWith("/media/") ||
      mount.startsWith("/mnt/") ||
      mount.startsWith("/run/media/")
    ) {
      const base = mount.replace(/\/$/, "");
      return `${base}/doma-storage`;
    }
    return mount;
  };

  const onApplyCustom = () => {
    const trimmed = customPath.trim();
    if (!trimmed) {
      toast.error("Введите путь");
      return;
    }
    if (trimmed === data?.localRoot) {
      toast.info("Этот путь уже активен");
      return;
    }
    setConfirmSwitch({ path: trimmed, isCustom: true });
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Загрузка информации о дисках…
      </div>
    );
  }

  const usedPct = data.localRootTotalBytes
    ? (data.localRootUsedBytes ?? 0) / Math.max(1, data.localRootTotalBytes) * 100
    : 0;
  const freePct = data.localRootTotalBytes
    ? (data.localRootFreeBytes ?? 0) / Math.max(1, data.localRootTotalBytes) * 100
    : 0;

  return (
    <div className="space-y-4">
      {/* Active storage card */}
      <Card className={data.localRootOk ? "border-border/40" : "border-destructive/40"}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Активное хранилище</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
            </Button>
          </div>
          <CardDescription>
            Файлы хранятся в локальной файловой системе
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Путь:</span>
                  <code className="font-mono text-xs break-all flex-1">{data.localRoot}</code>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Источник:</span>
                  {data.dbConfiguredRoot ? (
                    <Badge variant="secondary" className="gap-1 text-[10px] py-0 px-1.5">
                      <Database className="h-2.5 w-2.5" />
                      Настройка админа
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                      .env (STORAGE_LOCAL_ROOT)
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {data.localRootOk ? (
                    <Badge className="gap-1 text-[10px] py-0 px-1.5 bg-success/15 text-success">
                      <FolderCheck className="h-2.5 w-2.5" />
                      Доступен для записи
                    </Badge>
                  ) : (
                    <Badge className="gap-1 text-[10px] py-0 px-1.5 bg-destructive/15 text-destructive">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Недоступен
                    </Badge>
                  )}
                </div>
              </div>

              {data.localRootOk && data.localRootTotalBytes != null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Занято на диске</span>
                    <span className="tabular-nums">
                      {formatBytes(data.localRootUsedBytes ?? 0)} из {formatBytes(data.localRootTotalBytes)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden relative">
                    {/* Used by the archive (amber) on top of total used (muted) */}
                    <div
                      className="absolute inset-y-0 left-0 bg-muted-foreground/30"
                      style={{ width: `${Math.min(100, 100 - freePct)}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-primary"
                      style={{ width: `${Math.min(100, usedPct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{BRAND_SHORT}: {formatBytes(data.localRootUsedBytes ?? 0)}</span>
                    <span>Свободно: {formatBytes(data.localRootFreeBytes ?? 0)}</span>
                  </div>
                </div>
              )}

              {!data.localRootOk && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-destructive">
                    Директория хранилища недоступна. Загрузка файлов не будет работать.
                    Выберите доступный диск ниже или укажите путь вручную.
                  </div>
                </div>
              )}
        </CardContent>
      </Card>

      {/* Custom path input */}
      <Card className="border-border/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Указать путь вручную</CardTitle>
            </div>
            <CardDescription>
              Введите абсолютный путь к директории. Если она не существует — будет создана.
              Системные директории (/, /etc, /usr) запрещены.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/data/doma-storage"
                className="h-11 font-mono text-sm"
              />
              <Button onClick={onApplyCustom} disabled={saving} className="gap-1.5 shrink-0">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Применить
              </Button>
            </div>
            {data.dbConfiguredRoot && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyRoot(null)}
                disabled={saving}
                className="gap-1.5"
              >
                Сбросить к .env-умолчанию
              </Button>
            )}
          </CardContent>
        </Card>

      {/* Available disks */}
      <Card className="border-border/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Доступные диски</CardTitle>
            </div>
            <CardDescription>
              Смонтированные файловые системы, которые можно использовать под хранилище.
              Нажмите «Выбрать», чтобы переключиться.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.mounts.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Не удалось получить список дисков.
                {!data.supportsStatfs && " statfs недоступен на этой платформе."}
              </div>
            ) : (
              <div className="space-y-2">
                {data.mounts.map((disk) => (
                  <DiskRow
                    key={disk.mount}
                    disk={disk}
                    isActive={
                      data.localRoot === disk.mount ||
                      data.localRoot === `${disk.mount.replace(/\/$/, "")}/doma-storage` ||
                      data.dbConfiguredRoot === disk.mount ||
                      data.dbConfiguredRoot === `${disk.mount.replace(/\/$/, "")}/doma-storage`
                    }
                    onPick={() => onPickPath(storagePathForMount(disk.mount))}
                    disabled={saving}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      {/* Switch confirmation dialog */}
      {confirmSwitch && (
        <Dialog open onOpenChange={(o) => !o && setConfirmSwitch(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                Переключить хранилище?
              </DialogTitle>
              <DialogDescription>
                Новый путь: <code className="font-mono text-xs">{confirmSwitch.path}</code>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-warning-foreground">
                <div className="font-medium mb-1">Внимание!</div>
                <ul className="text-xs space-y-1 list-disc list-inside">
                  <li>Существующие файлы <strong>не переносятся</strong> автоматически.</li>
                  <li>Новые загрузки пойдут в новую директорию.</li>
                  <li>Старые файлы останутся доступными, пока не будет переключён root.</li>
                  <li>Чтобы перенести файлы — скопируйте их вручную
                    {" "}(<code className="font-mono">cp -r &lt;старый&gt;/* &lt;новый&gt;/</code> в Linux/macOS,
                    {" "}<code className="font-mono">robocopy &lt;старый&gt; &lt;новый&gt; /E</code> в Windows).
                  </li>
                  <li>Или воспользуйтесь командой <code className="font-mono">bun run storage:migrate-keys -- --apply</code> после копирования.</li>
                </ul>
              </div>
              <p className="text-muted-foreground text-xs">
                Рекомендуется сначала скопировать файлы в новую директорию, затем переключить путь.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmSwitch(null)}>
                Отмена
              </Button>
              <Button onClick={() => applyRoot(confirmSwitch.path)} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Переключить
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DiskRow({
  disk, isActive, onPick, disabled,
}: {
  disk: DiskInfo;
  isActive: boolean;
  onPick: () => void;
  disabled?: boolean;
}) {
  const usedPct = disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
  const isRoot = disk.mount === "/";
  const isPseudo = ["overlay", "tmpfs"].includes(disk.fsType) || disk.device.startsWith("overlay");
  const readOnly = disk.writable === false;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      isActive
        ? "border-primary bg-primary/5"
        : readOnly
          ? "border-border/40 opacity-70"
          : "border-border/40 hover:bg-muted/30"
    }`}>
      <div className="h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
        <HardDrive className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-sm font-medium truncate">{disk.mount}</code>
          {isActive && (
            <Badge className="gap-1 text-[10px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Активен
            </Badge>
          )}
          {readOnly && (
            <Badge className="gap-1 text-[10px] py-0 px-1.5 bg-destructive/15 text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              Только чтение
            </Badge>
          )}
          {isRoot && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              Корень системы
            </Badge>
          )}
          {isPseudo && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">
              {disk.fsType}
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {disk.device} · {disk.fsType}
        </div>
        {readOnly && disk.readOnlyReason && (
          <div className="text-[11px] text-destructive/90 mt-1 leading-snug">
            {disk.readOnlyReason}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 max-w-40 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${usedPct > 90 ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {formatBytes(disk.freeBytes)} своб. / {formatBytes(disk.totalBytes)}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant={isActive ? "ghost" : "secondary"}
        onClick={onPick}
        disabled={disabled || isActive || readOnly || isRoot}
        className="shrink-0"
        title={
          readOnly
            ? (disk.readOnlyReason ?? "Только чтение")
            : isRoot
              ? "Нельзя выбрать корень системы"
              : undefined
        }
      >
        {isActive ? "Активен" : readOnly ? "Недоступен" : "Выбрать"}
      </Button>
    </div>
  );
}

// ============= System Settings Tab =============

function SystemSettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.adminGetSettings(),
  });

  const [defaultQuotaGB, setDefaultQuotaGB] = React.useState("50");
  const [adminQuotaGB, setAdminQuotaGB] = React.useState("3072");
  const [registrationOpen, setRegistrationOpen] = React.useState(true);
  const [trashDays, setTrashDays] = React.useState("30");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (data) {
      const s: SystemSettings = data.settings;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDefaultQuotaGB(String(Math.round(Number(s.defaultQuotaBytes) / (1024 * 1024 * 1024))));
      setAdminQuotaGB(String(Math.round(Number(s.adminQuotaBytes) / (1024 * 1024 * 1024))));
      setRegistrationOpen(s.registrationOpen);
      setTrashDays(String(s.trashRetentionDays));
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const defaultQuotaBytes = BigInt(Math.round(parseFloat(defaultQuotaGB) * 1024 * 1024 * 1024)).toString();
      const adminQuotaBytes = BigInt(Math.round(parseFloat(adminQuotaGB) * 1024 * 1024 * 1024)).toString();
      await api.adminUpdateSettings({
        defaultQuotaBytes,
        adminQuotaBytes,
        registrationOpen,
        trashRetentionDays: parseInt(trashDays, 10),
      });
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast.success("Настройки сохранены");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Загрузка настроек…
      </div>
    );
  }

  return (
    <>
    <Card className="border-border/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Системные настройки</CardTitle>
        </div>
        <CardDescription>Применяются ко всей инсталляции «{BRAND_NAME}»</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="defaultQuota">Квота по умолчанию (ГБ)</Label>
          <Input
            id="defaultQuota"
            type="number"
            min="1"
            step="1"
            value={defaultQuotaGB}
            onChange={(e) => setDefaultQuotaGB(e.target.value)}
            className="h-11 max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            Выдаётся новым пользователям при самостоятельной регистрации.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adminQuota">Квота администратора (ГБ)</Label>
          <Input
            id="adminQuota"
            type="number"
            min="1"
            step="1"
            value={adminQuotaGB}
            onChange={(e) => setAdminQuotaGB(e.target.value)}
            className="h-11 max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            Выдаётся первому пользователю (он становится администратором) и всем
            новым аккаунтам с ролью «admin».
          </p>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <div className="text-sm font-medium">Открытая регистрация</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Если включено — кто угодно с доступом к URL может создать аккаунт.
              Выключите, чтобы регистрация была только через админ-панель.
            </p>
          </div>
          <Switch checked={registrationOpen} onCheckedChange={setRegistrationOpen} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="trashDays">Хранение корзины (дней)</Label>
          <Input
            id="trashDays"
            type="number"
            min="0"
            max="3650"
            value={trashDays}
            onChange={(e) => setTrashDays(e.target.value)}
            className="h-11 max-w-32"
          />
          <p className="text-xs text-muted-foreground">
            Файлы в корзине будут автоматически удалены навсегда через это количество дней.
            0 = никогда не удалять автоматически.
          </p>
        </div>

        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить настройки
        </Button>
      </CardContent>
    </Card>

    <QuotaMaintenanceCard />
    </>
  );
}

/**
 * Maintenance card — lets the admin trigger a full recompute of
 * `user.usedBytes` for every user. Useful as a sanity check after a crash
 * or after migrating from the old "compute on every read" accounting model.
 *
 * Shows before/after/drift per user so the admin can spot drift at a glance.
 */
function QuotaMaintenanceCard() {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{
    recomputed: number;
    users: Array<{ id: string; username: string; before: string; after: string; drift: string }>;
  } | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const r = await api.adminRecomputeQuotas();
      setResult(r);
      toast.success(`Пересчитано квот: ${r.recomputed}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось пересчитать");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Обслуживание квот</CardTitle>
        </div>
        <CardDescription>
          Пересчитать счётчик использованного места для всех пользователей.
          Запускайте после сбоев или если подозреваете расхождение с реальностью.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={run} disabled={running} variant="secondary" className="gap-1.5">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Пересчитать сейчас
        </Button>

        {result && (
          <div className="rounded-md border border-border/40 overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
              <div>Пользователь</div>
              <div className="text-right">Было</div>
              <div className="text-right">Стало</div>
              <div className="text-right">Δ</div>
            </div>
            {result.users.map((u) => {
              const drift = BigInt(u.drift);
              const driftColor = drift === 0n
                ? "text-muted-foreground"
                : drift > 0n
                  ? "text-success"
                  : "text-destructive";
              return (
                <div
                  key={u.id}
                  className="flex flex-col gap-1 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:gap-2 px-3 py-2.5 text-sm border-t border-border/30"
                >
                  <div className="truncate font-mono">@{u.username}</div>
                  <div className="flex justify-between gap-3 sm:contents text-xs sm:text-sm">
                    <div className="text-muted-foreground sm:text-right sm:text-foreground tabular-nums">
                      <span className="sm:hidden">Было: </span>{formatBytes(u.before)}
                    </div>
                    <div className="text-muted-foreground sm:text-right sm:text-foreground tabular-nums">
                      <span className="sm:hidden">Стало: </span>{formatBytes(u.after)}
                    </div>
                    <div className={`sm:text-right tabular-nums ${driftColor}`}>
                      <span className="sm:hidden">Δ: </span>
                      {drift > 0n ? "+" : ""}{formatBytes(drift)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============= Helpers =============




