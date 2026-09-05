"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { QueryProvider } from "@/components/cloud/query-provider";
import { ThemeToggle } from "@/components/cloud/theme-toggle";
import { SetupScreen } from "@/components/cloud/screens/setup-screen";
import { LoginScreen } from "@/components/cloud/screens/login-screen";
import { FileBrowser } from "@/components/cloud/file-browser";
import { LightRays } from "@/components/cloud/decor/light-rays";
import { SeasonalAccent } from "@/components/cloud/decor/seasonal";
import { BirthdayGreeting } from "@/components/cloud/decor/birthday-greeting";
import { useTheme } from "@wrksz/themes/client";

interface Props {
  needsSetup: boolean;
  initialUser: CurrentUser | null;
}

export function CloudApp({ needsSetup, initialUser }: Props) {
  const [user, setUser] = React.useState<CurrentUser | null>(initialUser);
  const [setupNeeded, setSetupNeeded] = React.useState(needsSetup);
  const theme = useTheme();
  const setTheme = theme.setTheme;

  // Register SW for PWA — but ONLY in production. In dev, the SW's
  // cache-first policy on static assets breaks Turbopack HMR.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // Apply the user's saved theme preference once on login. Without this,
  // a user who picked "dark" on one device sees the system theme on another.
  React.useEffect(() => {
    if (!user) return;
    // Fetch the profile (which includes themePreference) and apply it.
    api.getProfile().then(({ user: profile }) => {
      if (profile.themePreference) {
        setTheme(profile.themePreference);
      }
    }).catch(() => undefined);
  }, [user?.id, setTheme]);

  // Refresh session on focus (so a logout from another tab is reflected).
  // We DEBOUNCE focus events because some OSes fire them rapidly when
  // switching windows, and we don't want to spam /api/me.
  const lastCheckRef = React.useRef(0);
  React.useEffect(() => {
    const onFocus = async () => {
      if (setupNeeded) return;
      // Debounce — skip if we checked less than 5s ago.
      const now = Date.now();
      if (now - lastCheckRef.current < 5000) return;
      lastCheckRef.current = now;
      try {
        const { user } = await api.me();
        // Always update — keeps quota/role fresh and signs the user out
        // if the session expired in another tab.
        setUser(user);
      } catch {
        // Network error — don't sign the user out. They might just have
        // a flaky connection. The next successful focus check will catch up.
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [setupNeeded]);

  let content: React.ReactNode;
  if (setupNeeded) {
    content = (
      <SetupScreen
        onDone={(u) => {
          setUser(u);
          setSetupNeeded(false);
        }}
      />
    );
  } else if (!user) {
    content = <LoginScreen onDone={(u) => setUser(u)} />;
  } else {
    content = (
      <FileBrowser
        user={user}
        onLogout={() => setUser(null)}
        onUserUpdated={(u) => setUser(u)}
      />
    );
  }

  return (
    <QueryProvider>
      <div className="relative min-h-screen flex flex-col">
        {/* Atmospheric layers — fixed, behind everything */}
        <LightRays />
        <SeasonalAccent />

        {content}

        {/* Birthday greeting (only renders on the user's special day) */}
        <BirthdayGreeting user={user} />

        {/* Theme toggle — desktop only. On mobile the bottom tab bar owns
            that corner; theme lives in Settings. */}
        <div
          className="hidden md:block fixed z-50 bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3"
        >
          <ThemeToggle />
        </div>
      </div>
    </QueryProvider>
  );
}
