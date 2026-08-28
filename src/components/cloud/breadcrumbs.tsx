"use client";

import * as React from "react";
import { useCloudStore } from "@/lib/cloud/store";
import { ChevronRight, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function Breadcrumbs() {
  // Individual selectors — see cloud-sidebar.tsx for why this matters
  // in zustand v5 (stale closure avoidance).
  const path = useCloudStore((s) => s.path);
  const popTo = useCloudStore((s) => s.popTo);
  const view = useCloudStore((s) => s.view);

  if (view === "trash") {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
        <span className="font-medium text-foreground truncate">Корзина</span>
      </div>
    );
  }

  if (view === "shared") {
    return (
      <nav
        aria-label="Путь"
        className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto scrollbar-none"
      >
        {path.map((seg, i) => {
          const isLast = i === path.length - 1;
          const isFirst = i === 0;
          return (
            <React.Fragment key={`${seg.id ?? "root"}-${i}`}>
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              )}
              <button
                onClick={() => !isLast && popTo(i)}
                title={seg.name}
                className={cn(
                  "flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md text-sm transition max-w-[10rem] sm:max-w-[14rem] outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  isLast
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                {isFirst && <Users className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{seg.name}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Путь"
      className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto scrollbar-none"
    >
      {path.map((seg, i) => {
        const isLast = i === path.length - 1;
        return (
          <React.Fragment key={`${seg.id ?? "root"}-${i}`}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <button
              onClick={() => !isLast && popTo(i)}
              title={seg.name}
              className={cn(
                "flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md text-sm transition max-w-[10rem] sm:max-w-[14rem] outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isLast
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {i === 0 && <Home className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{seg.name}</span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
