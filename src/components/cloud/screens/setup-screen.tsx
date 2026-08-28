"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookHeart, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/cloud/brand";

interface Props {
  onDone: (user: CurrentUser) => void;
}

export function SetupScreen({ onDone }: Props) {
  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (password.length < 6) {
      toast.error("Пароль должен быть не короче 6 символов");
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.register({
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        password,
      });
      toast.success(`Добро пожаловать, ${user.displayName}! Вы — администратор.`);
      onDone(user);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать аккаунт");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 ring-4 ring-primary/5">
            <BookHeart className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{BRAND_NAME}</h1>
          <p className="text-muted-foreground mt-1">{BRAND_TAGLINE}</p>
        </div>

        <Card className="border-primary/10 shadow-lg shadow-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <CardTitle className="text-xl">Первый запуск</CardTitle>
            </div>
            <CardDescription>
              Создайте учётную запись администратора. Первый пользователь получает
              полный доступ; квоту можно изменить позже в настройках.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={submit}
              method="post"
              action="#"
              className="space-y-4"
              noValidate
            >
              <div className="space-y-1.5">
                <Label htmlFor="username">Логин</Label>
                <Input
                  id="username"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="например, papa"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9._\-]+"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Отображаемое имя</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="например, Папа"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Повторите пароль</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 text-base"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Создаём…
                  </>
                ) : (
                  "Создать облако"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
          Все данные хранятся локально на вашем мини-ПК. Ничего не отправляется
          во внешние сервисы.
        </p>
      </div>
    </div>
  );
}
