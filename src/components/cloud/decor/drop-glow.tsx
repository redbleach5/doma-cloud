"use client";

import * as React from "react";

/**
 * DropGlow — когда пользователь отпускает файлы над зоной загрузки,
 * из точки drop летят светящиеся тёплые капли, которые «впитываются» в папку.
 *
 * Подписывается на глобальное событие "doma:drop-burst" (CustomEvent),
 * которое диспатчится из FileBrowser при drop.
 *
 * Капли — это абсолютно позиционированные div'ы с CSS-анимацией,
 * которые удаляются после завершения. Не нагружают ни canvas, ни основной RAF.
 */

interface Drop {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
  delay: number;
}

const DROPLET_COLORS = [
  "oklch(0.78 0.18 65)",
  "oklch(0.7 0.2 50)",
  "oklch(0.82 0.15 75)",
  "oklch(0.65 0.18 35)",
];

let dropIdCounter = 0;

export function fireDropGlow(x: number, y: number, count = 14) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("doma:drop-burst", { detail: { x, y, count } })
  );
}

export function DropGlow() {
  const [drops, setDrops] = React.useState<Drop[]>([]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { x: number; y: number; count: number };
      const count = Math.min(20, detail.count);
      const newDrops: Drop[] = Array.from({ length: count }, (_, i) => {
        const angle = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const distance = 80 + Math.random() * 120;
        return {
          id: dropIdCounter++,
          x: detail.x,
          y: detail.y,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          size: 4 + Math.random() * 6,
          color: DROPLET_COLORS[i % DROPLET_COLORS.length],
          delay: i * 15,
        };
      });

      setDrops((prev) => [...prev, ...newDrops]);

      setTimeout(() => {
        const ids = new Set(newDrops.map((d) => d.id));
        setDrops((prev) => prev.filter((d) => !ids.has(d.id)));
      }, 900 + count * 15);
    };

    window.addEventListener("doma:drop-burst", handler);
    return () => window.removeEventListener("doma:drop-burst", handler);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="absolute rounded-full"
          style={
            {
              left: `${drop.x}px`,
              top: `${drop.y}px`,
              width: `${drop.size}px`,
              height: `${drop.size}px`,
              background: drop.color,
              boxShadow: `0 0 ${drop.size * 2}px ${drop.color}`,
              "--dx": `${drop.dx}px`,
              "--dy": `${drop.dy}px`,
              animation: `doma-drop-fly 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards`,
              animationDelay: `${drop.delay}ms`,
              opacity: 0,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
