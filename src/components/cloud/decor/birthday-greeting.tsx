"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { plural } from "@/lib/cloud/plural";
import {
  birthdayAgeYears,
  isBirthdayToday,
  isLocalMonthDay,
  localDateKey,
} from "@/lib/cloud/birthday";

/**
 * BirthdayGreeting — в день рождения пользователя показывает мягкое тёплое
 * поздравление в углу + лёгкое мерцание «свечей» в фоне.
 *
 * Если поле birthday не задано — fallback на годовщину создания аккаунта
 * («вашей библиотеке исполняется N лет»).
 *
 * Поздравление можно закрыть — оно не вернётся до следующего локального дня.
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
        const { user: profile } = await api.getProfile();
        if (cancelled) return;

        const now = new Date();
        const dismissedKey = `doma:bday-dismissed:${localDateKey(now)}`;
        if (localStorage.getItem(dismissedKey) === "1") {
          setProfileChecked(true);
          return;
        }

        if (profile.birthday && isBirthdayToday(profile.birthday, now)) {
          setMode("birthday");
          setAge(birthdayAgeYears(profile.birthday, now));
          setShow(true);
          setProfileChecked(true);
          return;
        }

        // Fallback: account creation anniversary (local calendar day).
        const createdAt = new Date(profile.createdAt);
        const isAnniversary =
          isLocalMonthDay(createdAt, now) &&
          createdAt.getFullYear() < now.getFullYear();
        if (isAnniversary) {
          setMode("anniversary");
          setAge(now.getFullYear() - createdAt.getFullYear());
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
    // Depends on user?.id only — cloud-app polls /api/me and would re-fetch
    // profile on every new user object identity otherwise.
  }, [user?.id]);

  const dismiss = () => {
    localStorage.setItem(`doma:bday-dismissed:${localDateKey()}`, "1");
    setShow(false);
  };

  if (!show || !profileChecked) return null;

  const greeting = mode === "birthday"
    ? `С днём рождения, ${user?.displayName ?? ""}!`
    : age === null
      ? "С праздником!"
      : `Сегодня вашей истории исполняется ${age} ${plural(age, "год", "года", "лет")}`;

  const subtext = mode === "birthday"
    ? "Пусть этот год принесёт ещё больше тёплых воспоминаний. Спасибо, что храните их дома."
    : "Спасибо, что храните близкое дома. Пусть этот год принесёт ещё больше тёплых воспоминаний.";

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 -z-10 w-96 h-96 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 70% 80%, rgba(255, 180, 100, 0.15), transparent 60%)",
          animation: "doma-candle-flicker 3s ease-in-out infinite alternate",
        }}
      />

      <div className="fixed z-40 max-w-xs animate-in slide-in-from-bottom-4 duration-500 right-4 bottom-[max(5rem,calc(5rem+env(safe-area-inset-bottom)))]">
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
    </>
  );
}
