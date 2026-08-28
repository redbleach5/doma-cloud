"use client";

import { BookHeart } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/cloud/brand";

interface Props {
  onClick?: () => void;
  /** Hide the wordmark (icon only). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Primary product mark — one place for icon + wordmark so header/sidebar
 * don't drift into duplicated, mismatched branding.
 */
export function DomaBrand({ onClick, iconOnly = false, className }: Props) {
  const content = (
    <>
      <div className="h-8 w-8 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center ring-2 ring-primary/5 group-hover:ring-primary/20 transition">
        <BookHeart className="h-5 w-5 text-primary" aria-hidden />
      </div>
      {!iconOnly && (
        <span className="font-semibold text-base sm:text-lg tracking-tight truncate">
          {BRAND_NAME}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn("flex items-center gap-2 group min-w-0", className)}
        aria-label={`${BRAND_NAME} — на главную`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-2 min-w-0", className)}
      aria-label={BRAND_NAME}
    >
      {content}
    </div>
  );
}
