"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";

/**
 * Doma Birthday — в день рождения пользователя показывает мягкое тёплое
 * поздравление в углу + лёгкое мерцание «свечей» в фоне.
 *
 * Если поле birthday не задано — fallback на годовщину создания аккаунта
 * («вашей библиотеке исполняется N лет»).
 *
 * Поздравление можно закрыть — оно не вернётся до следующего дня.
 */

interface Props {
  user: CurrentUser | null;
}

export function BirthdayGreeting({ user }: Props) {
  const [show, setShow] = React.useState(false);
  const [mode, setMode] = React.useState<"birthday" | "anniversary">("anniversary");
  const [age, setAge] = React.useState<number | null>(null);
  const [profileChecked, setProfileChecked] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        // Fetch full profile to get the birthday field.
        const { user: profile } = await api.getProfile();
        if (cancelled) return;

        const today = new Date();
        const todayKey = today.toISOString().slice(0, 10);
        const dismissedKey = `doma:bday-dismissed:${todayKey}`;
        if (localStorage.getItem(dismissedKey) === "1") {
          setProfileChecked(true);
          return;
        }

        // Check birthday first.
        if (profile.birthday) {
          const bday = new Date(profile.birthday);
          if (
            bday.getMonth() === today.getMonth() &&
            bday.getDate() === today.getDate()
          ) {
            const years = today.getFullYear() - bday.getFullYear();
            setMode("birthday");
            setAge(years);
            setShow(true);
            setProfileChecked(true);
            return;
          }
        }

        // Fallback: account creation anniversary.
        const createdAt = new Date(profile.createdAt);
        const isAnniversary =
          createdAt.getMonth() === today.getMonth() &&
          createdAt.getDate() === today.getDate() &&
          createdAt.getFullYear() < today.getFullYear();
        if (isAnniversary) {
          setMode("anniversary");
          setAge(today.getFullYear() - createdAt.getFullYear());
          setShow(true);
        }
        setProfileChecked(true);
      } catch {
        setProfileChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const dismiss = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(`doma:bday-dismissed:${today}`, "1");
    setShow(false);
  };

  if (!show || !profileChecked) return null;

  const greeting = mode === "birthday"
    ? `С днём рождения, ${user?.displayName ?? ""}!`
    : age === null
      ? "С праздником!"
      : `Сегодня вашей библиотеке исполняется ${age} ${plural(age, "год", "года", "лет")}`;

  const subtext = mode === "birthday"
    ? "Пусть этот год принесёт ещё больше тёплых воспоминаний. Спасибо, что храните их дома."
    : "Спасибо, что храните близкое дома. Пусть этот год принесёт ещё больше тёплых воспоминаний.";

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 -z-5 w-96 h-96 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 70% 80%, rgba(255, 180, 100, 0.15), transparent 60%)",
          animation: "doma-candle-flicker 3s ease-in-out infinite alternate",
        }}
      />

      <div className="fixed bottom-4 right-4 z-50 max-w-xs animate-in slide-in-from-bottom-4 duration-500">
        <div className="relative rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-md p-4 shadow-2xl shadow-primary/20">
          <div className="flex items-start gap-3">
            <div
              className="text-2xl select-none"
              style={{ animation: "doma-candle-flicker 1.5s ease-in-out infinite alternate" }}
            >
              {mode === "birthday" ? "🎂" : "🕯️"}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{greeting}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtext}</div>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition shrink-0"
              aria-label="Закрыть поздравление"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes doma-candle-flicker {
          0% { opacity: 0.85; transform: scale(1) translateY(0); }
          25% { opacity: 1; transform: scale(1.03) translateY(-1px); }
          50% { opacity: 0.9; transform: scale(0.98) translateY(0.5px); }
          75% { opacity: 1; transform: scale(1.02) translateY(-0.5px); }
          100% { opacity: 0.88; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
