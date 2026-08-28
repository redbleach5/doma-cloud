"use client";

import * as React from "react";

/**
 * LightRays — медленно плывущие пылинки в диагональном «луче света».
 *
 * Атмосфера как в избе зимой: сквозь невидимое окно падает тёплый луч,
 * в нём медленно кружатся и оседают пылинки. Очень тонко — не отвлекает.
 *
 * Реализация: canvas 2D с requestAnimationFrame. Производительность:
 *   - ~40 частиц на десктопе, ~20 на мобильных (по matchMedia)
 *   - пауза анимации когда вкладка не видна (visibilitychange)
 *   - respect prefers-reduced-motion — частицы статичны
 */

interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  phase: number; // для лёгкого мерцания
  phaseSpeed: number;
}

interface Props {
  /** Плотность частиц. По умолчанию 1.0. */
  density?: number;
  /** Цвет пылинок в формате oklch или rgb. */
  color?: string;
  /** Угол луча в градусах (0 = вправо, 90 = вниз). */
  rayAngle?: number;
}

export function LightRays({
  density = 1.0,
  color = "217, 167, 98",
  rayAngle = 35,
}: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rafRef = React.useRef<number | null>(null);
  const particlesRef = React.useRef<DustParticle[]>([]);
  const sizeRef = React.useRef({ w: 0, h: 0, dpr: 1 });

  // No "enabled" state: the canvas is blank until the effect below starts
  // the animation, so SSR and first client paint already match. Desktop-only
  // and reduced-motion checks live inside the effect.

  // Init + resize + animation loop. Skipped on mobile and for users who
  // prefer reduced motion — the canvas just stays blank.
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(max-width: 768px)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = Math.round(45 * density);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Re-seed particles on resize.
      particlesRef.current = Array.from({ length: count }, () => spawnParticle(w, h));
    };

    const spawnParticle = (w: number, h: number): DustParticle => {
      // Spawn anywhere, but bias toward the upper-left where the ray originates.
      const rayRad = (rayAngle * Math.PI) / 180;
      const along = Math.random() * Math.max(w, h) * 1.2;
      const across = (Math.random() - 0.5) * Math.min(w, h) * 0.9;
      const x = -50 + along * Math.cos(rayRad) - across * Math.sin(rayRad);
      const y = -50 + along * Math.sin(rayRad) + across * Math.cos(rayRad);
      return {
        x: x < -100 || x > w + 100 ? Math.random() * w : x,
        y: y < -100 || y > h + 100 ? Math.random() * h : y,
        vx: 0.08 + Math.random() * 0.12, // медленный дрейф вправо
        vy: 0.02 + Math.random() * 0.04, // почти невесомое падение
        radius: 0.6 + Math.random() * 1.8,
        opacity: 0.15 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.002 + Math.random() * 0.004,
      };
    };

    resize();
    window.addEventListener("resize", resize);

    let lastTime = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - lastTime) / 16.67, 2); // normalize to 60fps
      lastTime = now;
      const { w, h } = sizeRef.current;

      ctx.clearRect(0, 0, w, h);

      // Draw the soft "ray of light" — a diagonal gradient band.
      const rayRad = (rayAngle * Math.PI) / 180;
      const cx = w * 0.15;
      const cy = -50;
      const rayLength = Math.hypot(w, h) * 1.3;
      const rayEndX = cx + Math.cos(rayRad) * rayLength;
      const rayEndY = cy + Math.sin(rayRad) * rayLength;

      const gradient = ctx.createLinearGradient(cx, cy, rayEndX, rayEndY);
      gradient.addColorStop(0, `rgba(${color}, 0.10)`);
      gradient.addColorStop(0.4, `rgba(${color}, 0.05)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = gradient;

      // Draw the ray as a rotated rectangle.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rayRad);
      const rayWidth = Math.min(w, h) * 0.5;
      ctx.fillRect(0, -rayWidth / 2, rayLength, rayWidth);
      ctx.restore();

      // Update + draw particles.
      for (const p of particlesRef.current) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += p.phaseSpeed * dt;

        // Wrap around when out of bounds.
        if (p.x > w + 50) p.x = -50;
        if (p.y > h + 50) p.y = -50;
        if (p.x < -100) p.x = w + 50;

        const twinkle = 0.6 + 0.4 * Math.sin(p.phase);
        const alpha = p.opacity * twinkle;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.fill();

        // Subtle glow halo on larger particles.
        if (p.radius > 1.4) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 2.5, 0, Math.PI * 2);
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 2.5);
          halo.addColorStop(0, `rgba(${color}, ${alpha * 0.3})`);
          halo.addColorStop(1, `rgba(${color}, 0)`);
          ctx.fillStyle = halo;
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    if (!reducedMotion) {
      rafRef.current = requestAnimationFrame(draw);
    } else {
      // Static frame for reduced-motion users.
      draw(performance.now());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }

    // Pause when tab hidden — saves battery on phones.
    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!reducedMotion && !rafRef.current) {
        lastTime = performance.now();
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [density, color, rayAngle]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 opacity-70"
    />
  );
}
