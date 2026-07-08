"use client";

import * as React from "react";

/**
 * Doma Seasonal — очень тонкие сезонные акценты на фоне.
 *
 *   Зима (дек–фев):   редкие снежинки, медленно падающие
 *   Весна (мар–май):  редкие лепестки сакуры, плывущие по диагонали
 *   Лето (июн–авг):   золотистые пылинки-солнечные зайчики
 *   Осень (сен–ноя):  маленькие осенние листья, кружащиеся при падении
 *
 * Плотность намеренно низкая — это не эффект, а едва уловимая деталь.
 * Уважает prefers-reduced-motion (тогда вообще не рендерится).
 */

type Season = "winter" | "spring" | "summer" | "autumn";

function currentSeason(): Season {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  opacity: number;
  emoji: string;
  drift: number;
  driftSpeed: number;
}

const SEASON_CONFIG: Record<
  Season,
  { emoji: string[]; count: number; baseSpeed: number; drift: number }
> = {
  winter: {
    emoji: ["❄", "❅", "❆"],
    count: 12,
    baseSpeed: 0.3,
    drift: 0.5,
  },
  spring: {
    emoji: ["🌸", "🌷", "💮"],
    count: 8,
    baseSpeed: 0.25,
    drift: 0.7,
  },
  summer: {
    emoji: ["✨", "·"],
    count: 18,
    baseSpeed: 0.15,
    drift: 0.3,
  },
  autumn: {
    emoji: ["🍂", "🍁"],
    count: 8,
    baseSpeed: 0.35,
    drift: 0.9,
  },
};

export function SeasonalAccent() {
  const [season] = React.useState<Season>(() => currentSeason());
  const [particles, setParticles] = React.useState<Particle[]>([]);
  const [enabled, setEnabled] = React.useState(true);

  React.useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setEnabled(false);
      return;
    }

    const cfg = SEASON_CONFIG[season];
    const init: Particle[] = Array.from({ length: cfg.count }, (_, i) => ({
      id: i,
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: cfg.drift * (Math.random() - 0.5) * 0.5,
      vy: cfg.baseSpeed * (0.5 + Math.random()),
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 1.5,
      size: 10 + Math.random() * 14,
      opacity: 0.25 + Math.random() * 0.35,
      emoji: cfg.emoji[Math.floor(Math.random() * cfg.emoji.length)],
      drift: cfg.drift,
      driftSpeed: 0.005 + Math.random() * 0.01,
    }));
    setParticles(init);
  }, [season]);

  React.useEffect(() => {
    if (!enabled || particles.length === 0) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      setParticles((prev) =>
        prev.map((p) => {
          let { x, y, vx, vy, rotation, rotationSpeed, drift, driftSpeed } = p;
          // Sine-wave horizontal drift — leaves/petals sway as they fall.
          x += (vx + Math.sin(now * driftSpeed) * drift * 0.4) * dt;
          y += vy * dt;
          rotation += rotationSpeed * dt;

          // Wrap around.
          if (y > window.innerHeight + 30) {
            y = -30;
            x = Math.random() * window.innerWidth;
          }
          if (x > window.innerWidth + 30) x = -30;
          if (x < -30) x = window.innerWidth + 30;

          return { ...p, x, y, rotation };
        })
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, particles.length]);

  if (!enabled || particles.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute will-change-transform select-none"
          style={{
            left: `${p.x}px`,
            top: `${p.y}px`,
            fontSize: `${p.size}px`,
            opacity: p.opacity,
            transform: `rotate(${p.rotation}deg)`,
            filter: "blur(0.3px)",
          }}
        >
          {p.emoji}
        </div>
      ))}
    </div>
  );
}
