"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FolderStack — иконка папки как стопка листов (SVG).
 * На hover верхний лист приподнимается, под стопкой появляется свечение.
 */

interface Props {
  hovered?: boolean;
  className?: string;
}

export function FolderStack({ hovered, className }: Props) {
  return (
    <div
      className={cn(
        "relative w-full h-full flex items-center justify-center transition-all duration-500",
        className
      )}
    >
      {/* Soft warm glow under the stack — appears on hover */}
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-xl transition-opacity duration-500",
          hovered ? "opacity-100" : "opacity-0"
        )}
        style={{
          background:
            "radial-gradient(circle at 50% 60%, oklch(0.78 0.18 65 / 0.4), transparent 70%)",
        }}
      />

      <svg
        viewBox="0 0 100 100"
        className={cn(
          "relative w-3/4 h-3/4 transition-transform duration-500",
          hovered && "-translate-y-1 scale-105"
        )}
        aria-hidden
      >
        {/* Bottom sheet — rotated slightly */}
        <g
          transform="rotate(-8 50 50)"
          style={{ transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          <rect
            x="20" y="28" width="60" height="50" rx="4"
            fill="oklch(0.93 0.04 65)"
            stroke="oklch(0.7 0.05 65 / 0.4)"
            strokeWidth="0.5"
          />
        </g>

        {/* Middle sheet */}
        <g
          transform="rotate(4 50 50)"
          style={{ transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          <rect
            x="22" y="26" width="56" height="48" rx="4"
            fill="oklch(0.95 0.05 60)"
            stroke="oklch(0.7 0.05 65 / 0.5)"
            strokeWidth="0.5"
          />
        </g>

        {/* Top sheet — the visible "folder cover" */}
        <g
          transform={hovered ? "translate(0, -3) rotate(-2 50 50)" : "rotate(-2 50 50)"}
          style={{ transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {/* Folder body */}
          <path
            d="M 18 32 Q 18 28 22 28 L 40 28 L 44 32 L 78 32 Q 82 32 82 36 L 82 70 Q 82 74 78 74 L 22 74 Q 18 74 18 70 Z"
            fill="oklch(0.62 0.13 55)"
            stroke="oklch(0.5 0.15 50)"
            strokeWidth="0.5"
          />
          {/* Tab highlight */}
          <path
            d="M 18 32 Q 18 28 22 28 L 40 28 L 44 32 L 22 32 Z"
            fill="oklch(0.7 0.15 55)"
            opacity="0.6"
          />
          {/* Inner highlight — gives a soft "gloss" */}
          <rect
            x="22" y="36" width="56" height="2" rx="1"
            fill="oklch(0.99 0.01 75 / 0.3)"
          />
        </g>

        {/* Subtle inner shadow when hovered — depth */}
        {hovered && (
          <ellipse
            cx="50" cy="78" rx="28" ry="3"
            fill="oklch(0.4 0.04 50 / 0.2)"
            className="transition-opacity"
          />
        )}
      </svg>
    </div>
  );
}
