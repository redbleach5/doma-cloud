"use client";

import * as React from "react";
import { api, type CurrentUser } from "@/lib/cloud/api";
import { QueryProvider } from "@/components/cloud/query-provider";
import { ThemeToggle } from "@/components/cloud/theme-toggle";
import { SetupScreen } from "@/components/cloud/screens/setup-screen";
import { LoginScreen } from "@/components/cloud/screens/login-screen";
import { FileBrowser } from "@/components/cloud/file-browser";
import { DustRays } from "@/components/cloud/atmosphere/dust-rays";
import { SeasonalAccent } from "@/components/cloud/atmosphere/seasonal";
import { BirthdayGreeting } from "@/components/cloud/atmosphere/birthday-greeting";
import { useTheme } from "next-themes";

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
        // Only update state if the session actually changed — avoids
        // unnecessary re-renders on every focus.
        setUser((prev) => (prev?.id === user?.id ? user : user));
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
        <DustRays />
        <SeasonalAccent />

        {content}

        {/* Birthday greeting (only renders on the user's special day) */}
        <BirthdayGreeting user={user} />

        {/* Theme toggle — z-50 sits ABOVE the upload overlay (z-40) so it
            stays clickable even when an upload is in progress. The previous
            z-30 meant the toggle was blocked for the entire duration of a
            long upload (could be 30+ minutes for a 5GB file). */}
        <div className="fixed bottom-3 right-3 z-50">
          <ThemeToggle />
        </div>
      </div>
    </QueryProvider>
  );
}
