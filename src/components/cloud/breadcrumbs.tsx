"use client";

import * as React from "react";
import { useCloudStore } from "@/lib/cloud/store";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export function Breadcrumbs() {
  const { path, popTo, view } = useCloudStore();

  if (view === "trash") {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Корзина</span>
      </div>
    );
  }

  return (
    <nav aria-label="Путь" className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto scrollbar-none">
      {path.map((seg, i) => {
        const isLast = i === path.length - 1;
        return (
          <React.Fragment key={`${seg.id ?? "root"}-${i}`}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
            <button
              onClick={() => !isLast && popTo(i)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-sm whitespace-nowrap transition",
                isLast
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              {i === 0 && <Home className="h-3.5 w-3.5" />}
              {seg.name}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
