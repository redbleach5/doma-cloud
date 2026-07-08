"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" className="rounded-full bg-background/80 backdrop-blur">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = theme === "dark";
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
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isDark ? "Светлая тема" : "Тёмная тема"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
