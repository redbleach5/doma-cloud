"use client";

import * as React from "react";
import { useTheme } from "@wrksz/themes/client";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  // resolvedTheme reflects the EFFECTIVE theme — when preference is "system",
  // it returns the actual resolved "light" | "dark". Using `theme` here would
  // make the icon wrong whenever preference is "system" (the default after
  // login), and clicking would silently override the user's "system" choice.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" className="rounded-full bg-background/80 backdrop-blur">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full bg-background/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label="Переключить тему"
          >
            <Sun className={cn("h-4 w-4 absolute transition-all duration-300", isDark ? "opacity-0 rotate-90 scale-0" : "opacity-100 rotate-0 scale-100")} />
            <Moon className={cn("h-4 w-4 absolute transition-all duration-300", isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-0")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isDark ? "Светлая тема" : "Тёмная тема"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
