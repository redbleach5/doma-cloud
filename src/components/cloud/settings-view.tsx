"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { useTheme } from "@wrksz/themes/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  User as UserIcon,
  Lock,
  Palette,
  Save,
  Loader2,
  LogOut,
  Cake,
  Sun,
  Moon,
  Monitor,
  Download,
  Smartphone,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/cloud/format";
import { birthdayDateInputValue, toBirthdayIso } from "@/lib/cloud/birthday";
import { BRAND_NAME } from "@/lib/cloud/brand";
import { useCloudStore } from "@/lib/cloud/store";
import { isPwaInstalled } from "@/lib/cloud/pwa-install";

interface Props {
  user: CurrentUser;
  onUserUpdated: (u: CurrentUser) => void;
  onLogout: () => void;
}

export function SettingsView({ user, onUserUpdated, onLogout }: Props) {
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // «Установить приложение» guide dialog (shared with the phone hint).
  const setInstallDialogOpen = useCloudStore((s) => s.setInstallDialogOpen);
  // Installed-state is computed after mount to avoid hydration mismatch.
  const [appInstalled, setAppInstalled] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAppInstalled(isPwaInstalled());
  }, []);

  // Fetch full profile (with birthday, themePreference, etc.)
  const { data: profileData, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
  });

  const profile = profileData?.user;

  // Local form state
  const [displayName, setDisplayName] = React.useState("");
  const [birthday, setBirthday] = React.useState("");
  const [savingProfile, setSavingProfile] = React.useState(false);

  // Password change
  const [currentPwd, setCurrentPwd] = React.useState("");
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [changingPwd, setChangingPwd] = React.useState(false);

  React.useEffect(() => {
    if (profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(profile.displayName);
      setBirthday(birthdayDateInputValue(profile.birthday));
    }
  }, [profile]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const birthdayIso = birthday ? toBirthdayIso(birthday) : null;
      const themePref = (theme as "light" | "dark" | "system") ?? "system";
      const { user: updated } = await api.updateProfile({
        displayName: displayName.trim(),
        birthday: birthdayIso,
        themePreference: themePref,
      });
      // Merge with the existing user object to keep quotaBytes etc.
      onUserUpdated({ ...user, ...updated });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Профиль сохранён");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd !== confirmPwd) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (newPwd.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    setChangingPwd(true);
    try {
      await api.changePassword(currentPwd, newPwd);
      toast.success("Пароль изменён");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setChangingPwd(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      qc.clear();
      onLogout();
    } catch {
      // ignore
    }
  };

  if (isLoading || !profile) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Загрузка профиля…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Личные настройки аккаунта: профиль, пароль, тема, день рождения.
        </p>
      </div>

      {/* Profile section */}
      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <UserIcon className="h-5 w-5" />
            <CardTitle className="text-lg">Профиль</CardTitle>
          </div>
          <CardDescription>Как вас зовут в «{BRAND_NAME}»</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Логин</Label>
            <Input
              id="username"
              value={profile.username}
              disabled
              className="bg-muted/40 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Логин нельзя изменить.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="displayName">Отображаемое имя</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birthday" className="flex items-center gap-1.5">
              <Cake className="h-3.5 w-3.5" />
              День рождения
            </Label>
            <Input
              id="birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              В этот день «{BRAND_NAME}» покажет поздравление.
            </p>
          </div>

          <div className="rounded-lg bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Роль</span>
              <span className="font-medium">
                {profile.role === "admin" ? "Администратор" : "Пользователь"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">С нами с</span>
              <span className="font-medium">{formatDate(profile.createdAt)}</span>
            </div>
            {profile.lastLoginAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Последний вход</span>
                <span className="font-medium">{formatDate(profile.lastLoginAt)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Квота</span>
              <span className="font-medium">{formatBytes(profile.quotaBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Использовано</span>
              <span className="font-medium">{formatBytes(profile.usedBytes)}</span>
            </div>
          </div>

          <Button onClick={saveProfile} disabled={savingProfile} className="gap-1.5">
            {savingProfile ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Сохранение…
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Сохранить
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Theme section */}
      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Palette className="h-5 w-5" />
            <CardTitle className="text-lg">Тема оформления</CardTitle>
          </div>
          <CardDescription>Светлая, тёмная или системная</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {(["light", "dark", "system"] as const).map((t) => {
              const isActive = mounted && theme === t;
              const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
              const label = t === "light" ? "Светлая" : t === "dark" ? "Тёмная" : "Системная";
              return (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`rounded-lg border p-4 text-sm transition-all flex flex-col items-center gap-2 ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary font-medium shadow-sm"
                      : "border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-6 w-6" />
                  {label}
                </button>
              );
            })}
          </div>
          {!mounted && (
            <p className="text-xs text-muted-foreground mt-2">Загрузка текущей темы…</p>
          )}
        </CardContent>
      </Card>

      {/* App installation (PWA guide dialog) */}
      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Smartphone className="h-5 w-5" />
            <CardTitle className="text-lg">Приложение</CardTitle>
          </div>
          <CardDescription>
            {appInstalled
              ? `${BRAND_NAME} уже установлена на этом устройстве — спасибо!`
              : `Иконка на главном экране телефона или отдельное окно на компьютере — ${BRAND_NAME} открывается без адресной строки`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            className="gap-1.5"
            onClick={() => setInstallDialogOpen(true)}
            data-testid="settings-install-app"
          >
            <Download className="h-4 w-4" />
            Как установить
          </Button>
        </CardContent>
      </Card>

      {/* Password change */}
      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <Lock className="h-5 w-5" />
            <CardTitle className="text-lg">Смена пароля</CardTitle>
          </div>
          <CardDescription>Используется для входа в облако</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPwd">Текущий пароль</Label>
              <Input
                id="currentPwd"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11"
              />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label htmlFor="newPwd">Новый пароль</Label>
              <Input
                id="newPwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPwd">Повторите новый пароль</Label>
              <Input
                id="confirmPwd"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="h-11"
              />
            </div>
            <Button type="submit" disabled={changingPwd} variant="secondary" className="gap-1.5">
              {changingPwd ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Меняем…
                </>
              ) : (
                "Сменить пароль"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Выход</CardTitle>
          <CardDescription>Завершить текущую сессию на этом устройстве</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleLogout} variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5">
            <LogOut className="h-4 w-4" />
            Выйти
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


