"use client";

import * as React from "react";

const MOVE_THRESHOLD_PX = 12;

/**
 * Long-press for mobile context menus.
 * Cancels only after the finger moves more than ~12px (not on every touchmove).
 * Fires with the touchstart coordinates (touches are gone by the time the timer runs).
 */
export function useLongPress(
  onFire: (coords: { x: number; y: number }) => void,
  delayMs = 500
) {
  const timerRef = React.useRef<number | null>(null);
  const firedRef = React.useRef(false);
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const onFireRef = React.useRef(onFire);
  const [highlight, setHighlight] = React.useState(false);

  React.useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = React.useCallback(
    (e: React.TouchEvent) => {
      firedRef.current = false;
      const t = e.touches[0];
      if (!t) return;
      startRef.current = { x: t.clientX, y: t.clientY };
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        const coords = startRef.current;
        if (!coords) return;
        firedRef.current = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          // vibrate may be blocked
        }
        setHighlight(true);
        window.setTimeout(() => setHighlight(false), 220);
        onFireRef.current(coords);
      }, delayMs);
    },
    [clearTimer, delayMs]
  );

  const onTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      const start = startRef.current;
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) {
        clearTimer();
      }
    },
    [clearTimer]
  );

  const onTouchEnd = React.useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onTouchCancel = React.useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  /** Call from click handler — returns true if long-press already handled the gesture. */
  const consumeIfFired = React.useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    consumeIfFired,
    highlight,
  };
}
