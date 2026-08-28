"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookHeart, Loader2, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/cloud/brand";

interface Props {
  onDone: (user: CurrentUser) => void;
}

export function LoginScreen({ onDone }: Props) {
  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<"login" | "register">(() => {
    if (typeof window === "undefined") return "login";
    return new URLSearchParams(window.location.search).get("mode") === "register"
      ? "register"
      : "login";
  });
  const [registrationAllowed, setRegistrationAllowed] = React.useState<boolean | null>(null);

  // Check if registration is open (only when entering register mode).
  React.useEffect(() => {
    if (mode !== "register" || registrationAllowed !== null) return;
    (async () => {
      try {
        const data = await api.getPublicSettings();
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
    const login = username.trim();
    if (login.length < 3) {
      toast.error("Логин — минимум 3 символа");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(login)) {
      toast.error("Логин: только латиница, цифры, точка, _ или -");
      return;
    }
    if (password.length < 6) {
      toast.error("Пароль должен быть не короче 6 символов");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const { user } = await api.login(login, password);
        toast.success(`С возвращением, ${user.displayName}!`);
        onDone(user);
      } else {
        const { user } = await api.register({
          username: login,
          displayName: displayName.trim() || undefined,
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
            <BookHeart className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{BRAND_NAME}</h1>
          <p className="text-muted-foreground mt-1">{BRAND_TAGLINE}</p>
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
                ? "Войдите под своей учётной записью, чтобы открыть семейный архив."
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
              <form onSubmit={submit} method="post" action="#" className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="username">Логин</Label>
                  <Input
                    id="username"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ваш логин"
                    autoComplete={mode === "login" ? "username" : "new-username"}
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9._\-]+"
                    title="Латиница, цифры, точка, подчёркивание или дефис"
                    autoFocus={typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches}
                    inputMode="text"
                    className="h-11"
                  />
                </div>
                {mode === "register" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName">Отображаемое имя</Label>
                    <Input
                      id="displayName"
                      name="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={username || "например, Мама"}
                      className="h-11"
                    />
                    <p className="text-xs text-muted-foreground">
                      Как вас будут видеть в интерфейсе. Можно оставить пустым — тогда используется логин.
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    name="password"
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
                <a
                  href="/?mode=register"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("register");
                    // Keep URL in sync so a refresh stays on the register form.
                    window.history.replaceState(null, "", "/?mode=register");
                  }}
                  className="text-sm text-muted-foreground hover:text-primary transition inline-block py-2"
                >
                  Нет аккаунта? Зарегистрироваться →
                </a>
              </div>
            )}
            {mode === "register" && registrationAllowed !== false && (
              <div className="mt-4 text-center">
                <a
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("login");
                    window.history.replaceState(null, "", "/");
                  }}
                  className="text-sm text-muted-foreground hover:text-primary transition inline-block py-2"
                >
                  ← Уже есть аккаунт? Войти
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
