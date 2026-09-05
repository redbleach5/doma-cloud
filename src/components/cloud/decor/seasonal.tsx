"use client";

import * as React from "react";

/**
 * SeasonalAccent — редкие сезонные частицы на фоне: снежинки (зима),
 * лепестки (весна), пылинки (лето), листья (осень). Плотность низкая.
 *
 * Рисуется в <canvas> напрямую из requestAnimationFrame, без React-состояния
 * в горячем цикле. На мобильных и при prefers-reduced-motion не рендерится.
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
  phase: number;
}

const SEASON_CONFIG: Record<
  Season,
  { emoji: string[]; count: number; baseSpeed: number; drift: number }
> = {
  winter: { emoji: ["❄", "❅", "❆"], count: 12, baseSpeed: 0.3, drift: 0.5 },
  spring: { emoji: ["🌸", "🌷", "💮"], count: 8, baseSpeed: 0.25, drift: 0.7 },
  summer: { emoji: ["✨", "·"], count: 18, baseSpeed: 0.15, drift: 0.3 },
  autumn: { emoji: ["🍂", "🍁"], count: 8, baseSpeed: 0.35, drift: 0.9 },
};

export function SeasonalAccent() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // No "enabled" state: the canvas is blank until the effect below starts,
  // so SSR and first client paint already match. Desktop-only and
  // reduced-motion checks live inside the effect.

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(max-width: 768px)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const season = currentSeason();
    const cfg = SEASON_CONFIG[season];
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Build the particle pool once — we mutate the same array in place
    // during the RAF loop, no React state involved.
    const particles: Particle[] = Array.from({ length: cfg.count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: cfg.drift * (Math.random() - 0.5) * 0.5,
      vy: cfg.baseSpeed * (0.5 + Math.random()),
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 1.5,
      size: 10 + Math.random() * 14,
      opacity: 0.25 + Math.random() * 0.35,
      emoji: cfg.emoji[Math.floor(Math.random() * cfg.emoji.length)],
      drift: cfg.drift,
      driftSpeed: 0.005 + Math.random() * 0.01,
      phase: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let last = performance.now();
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        // Sine-wave horizontal drift — leaves/petals sway as they fall.
        p.x += (p.vx + Math.sin(now * p.driftSpeed + p.phase) * p.drift * 0.4) * dt;
        p.y += p.vy * dt;
        p.rotation += p.rotationSpeed * dt;

        // Wrap around.
        if (p.y > height + 30) {
          p.y = -30;
          p.x = Math.random() * width;
        }
        if (p.x > width + 30) p.x = -30;
        if (p.x < -30) p.x = width + 30;

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.font = `${p.size}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.filter = "blur(0.3px)";
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
