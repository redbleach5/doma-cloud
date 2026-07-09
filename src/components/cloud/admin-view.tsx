"use client";

import * as React from "react";
import { api, type CurrentUser, type AdminUser, type SystemSettings } from "@/lib/cloud/api";
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
} from "lucide-react";
import { formatBytes } from "@/lib/cloud/format";

interface Props {
  currentUser: CurrentUser;
  onUserUpdated: (u: CurrentUser) => void;
}

export function AdminView({ currentUser }: Props) {
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-24">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Админ-панель</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Управление пользователями, квотами и системными настройками Doma.
      </p>

      <Tabs defaultValue="users">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Пользователи</span>
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Статистика</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <SettingsIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Система</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersTab currentUser={currentUser} />
        </TabsContent>
        <TabsContent value="stats" className="mt-4">
          <StatsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SystemSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============= Users Tab =============

function UsersTab({ currentUser }: { currentUser: CurrentUser }) {
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
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null);
            refresh();
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
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Редактировать">
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onResetPassword} aria-label="Сбросить пароль">
          <KeyRound className="h-3.5 w-3.5" />
        </Button>
        {!isSelf && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
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

function EditUserDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = React.useState(user.displayName);
  const [role, setRole] = React.useState<"admin" | "user">(user.role as "admin" | "user");
  const [quotaGB, setQuotaGB] = React.useState(() => {
    const gb = Number(user.quotaBytes) / (1024 * 1024 * 1024);
    return Number.isFinite(gb) ? String(Math.round(gb * 100) / 100) : "50";
  });
  const [birthday, setBirthday] = React.useState(user.birthday ? user.birthday.slice(0, 10) : "");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const quotaBytes = BigInt(Math.round(parseFloat(quotaGB) * 1024 * 1024 * 1024)).toString();
      const birthdayIso = birthday ? new Date(birthday + "T00:00:00").toISOString() : null;
      await api.adminUpdateUser(user.id, {
        displayName: displayName.trim(),
        role,
        quotaBytes,
        birthday: birthdayIso,
      });
      toast.success("Пользователь обновлён");
      onSaved();
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
            setNewPassword(Math.random().toString(36).slice(2, 10));
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
          color="text-amber-500"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Активных"
          value={String(data.users.active)}
          color="text-emerald-500"
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
          <StatRow label="В корзине" value={String(data.storage.trashCount) + " файлов"} />
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
        <CardDescription>Применяются ко всей инсталляции Doma</CardDescription>
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
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
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
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive";
              return (
                <div
                  key={u.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-sm border-t border-border/30"
                >
                  <div className="truncate font-mono">@{u.username}</div>
                  <div className="text-right tabular-nums">{formatBytes(u.before)}</div>
                  <div className="text-right tabular-nums">{formatBytes(u.after)}</div>
                  <div className={`text-right tabular-nums ${driftColor}`}>
                    {drift > 0n ? "+" : ""}{formatBytes(drift)}
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

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
