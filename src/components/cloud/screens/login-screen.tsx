"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud, Loader2, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  onDone: (user: CurrentUser) => void;
}

export function LoginScreen({ onDone }: Props) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [registrationAllowed, setRegistrationAllowed] = React.useState<boolean | null>(null);

  // Check if registration is open (only when entering register mode).
  React.useEffect(() => {
    if (mode !== "register" || registrationAllowed !== null) return;
    (async () => {
      try {
        const res = await fetch("/api/public-settings", { cache: "no-store" });
        const data = await res.json();
        setRegistrationAllowed(data.registrationOpen === true);
      } catch {
        // If the endpoint is unreachable (e.g. during initial setup),
        // default to allowing registration.
        setRegistrationAllowed(true);
      }
    })();
  }, [mode, registrationAllowed]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { user } = await api.login(username.trim(), password);
        toast.success(`С возвращением, ${user.displayName}!`);
        onDone(user);
      } else {
        const { user } = await api.register({
          username: username.trim(),
          password,
        });
        toast.success(`Добро пожаловать, ${user.displayName}!`);
        onDone(user);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 ring-4 ring-primary/5">
            <Cloud className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Doma</h1>
          <p className="text-muted-foreground mt-1">семейная библиотека</p>
        </div>

        <Card className="border-primary/10 shadow-lg shadow-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              {mode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              <CardTitle className="text-xl">
                {mode === "login" ? "Вход" : "Регистрация"}
              </CardTitle>
            </div>
            <CardDescription>
              {mode === "login"
                ? "Войдите под своей учётной записью, чтобы открыть библиотеку."
                : "Создайте новую учётную запись для члена семьи."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "register" && registrationAllowed === false ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Регистрация новых пользователей отключена администратором.
                  Попросите администратора создать вам аккаунт через админ-панель.
                </p>
                <Button variant="outline" onClick={() => setMode("login")}>
                  Вернуться ко входу
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Логин</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ваш логин"
                    autoComplete={mode === "login" ? "username" : "new-username"}
                    required
                    autoFocus
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={6}
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
                      {mode === "login" ? "Входим…" : "Создаём…"}
                    </>
                  ) : mode === "login" ? (
                    "Войти"
                  ) : (
                    "Создать аккаунт"
                  )}
                </Button>
              </form>
            )}

            {mode === "login" && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-sm text-muted-foreground hover:text-primary transition"
                >
                  Нет аккаунта? Зарегистрироваться →
                </button>
              </div>
            )}
            {mode === "register" && registrationAllowed !== false && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-sm text-muted-foreground hover:text-primary transition"
                >
                  ← Уже есть аккаунт? Войти
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
