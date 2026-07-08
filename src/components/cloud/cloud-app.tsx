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

interface Props {
  needsSetup: boolean;
  initialUser: CurrentUser | null;
}

export function CloudApp({ needsSetup, initialUser }: Props) {
  const [user, setUser] = React.useState<CurrentUser | null>(initialUser);
  const [setupNeeded, setSetupNeeded] = React.useState(needsSetup);

  // Register SW for PWA.
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // Refresh session on focus (so a logout from another tab is reflected).
  React.useEffect(() => {
    const onFocus = async () => {
      if (setupNeeded) return;
      try {
        const { user } = await api.me();
        setUser(user);
      } catch {}
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

        <div className="fixed bottom-3 right-3 z-50">
          <ThemeToggle />
        </div>
      </div>
    </QueryProvider>
  );
}
