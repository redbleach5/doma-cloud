"use client";

import * as React from "react";

/**
 * useSpringZoom — плавный зум изображений с пружинной физикой.
 *
 * Колесо/пинч/кнопки меняют targetScale; RAF подтягивает scale к цели
 * и останавливается, когда пружина успокоилась.
 *
 * Возвращает:
 *   - scale         текущий зум (для transform: scale())
 *   - targetScale   целевой (для отображения в UI)
 *   - zoomIn/out    кнопочные методы
 *   - reset         сброс к 1.0
 *   - onWheel       обработчик колесеса
 *   - onTouchStart/Move/End  обработчики пинча
 */

interface SpringState {
  scale: number;
  target: number;
  velocity: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const SPRING_STIFFNESS = 0.18;
const SPRING_DAMPING = 0.72;

export function useSpringZoom() {
  const [state, setState] = React.useState<SpringState>({ scale: 1, target: 1, velocity: 0 });
  const stateRef = React.useRef(state);
  // Update ref inside effect — never during render.
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const rafRef = React.useRef<number | null>(null);

  // Pinch tracking
  const pinchRef = React.useRef<{ startDist: number; startScale: number } | null>(null);

  const setTarget = React.useCallback((next: number) => {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    setState((s) => ({ ...s, target: clamped }));
  }, []);

  const zoomIn = React.useCallback(() => setTarget(stateRef.current.target * 1.3), [setTarget]);
  const zoomOut = React.useCallback(() => setTarget(stateRef.current.target / 1.3), [setTarget]);
  const reset = React.useCallback(() => setTarget(1), [setTarget]);

  const onWheel = React.useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setTarget(stateRef.current.target * factor);
    },
    [setTarget]
  );

  const onTouchStart = React.useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = {
        startDist: Math.hypot(dx, dy),
        startScale: stateRef.current.target,
      };
    }
  }, []);

  const onTouchMove = React.useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchRef.current.startDist;
        setTarget(pinchRef.current.startScale * ratio);
      }
    },
    [setTarget]
  );

  const onTouchEnd = React.useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
  }, []);

  // Spring physics loop — runs only while the spring is in motion.
  // RAF останавливается, когда пружина успокоилась (не держим 60 fps
  // впустую, пока открыт просмотр), и перезапускается из setTarget.
  React.useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      const force = (s.target - s.scale) * SPRING_STIFFNESS;
      const newVelocity = (s.velocity + force) * SPRING_DAMPING;
      const newScale = s.scale + newVelocity;

      if (Math.abs(s.target - newScale) < 0.001 && Math.abs(newVelocity) < 0.001) {
        // Settled — snap to target exactly and STOP the RAF loop.
        if (s.scale !== s.target) {
          setState({ scale: s.target, target: s.target, velocity: 0 });
        }
        rafRef.current = null;
        return;
      } else {
        setState({ scale: newScale, target: s.target, velocity: newVelocity });
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    // Kick off the loop only if the spring is currently in motion.
    if (stateRef.current.scale !== stateRef.current.target || Math.abs(stateRef.current.velocity) > 0.001) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Перезапуск RAF-цикла при смене target (колесо / пинч / кнопки) —
  // иначе после успокоения пружины некому тянуть scale к новой цели.
  React.useEffect(() => {
    if (state.scale === state.target && Math.abs(state.velocity) < 0.001) return;
    if (rafRef.current !== null) return; // already running
    const tick = () => {
      const s = stateRef.current;
      const force = (s.target - s.scale) * SPRING_STIFFNESS;
      const newVelocity = (s.velocity + force) * SPRING_DAMPING;
      const newScale = s.scale + newVelocity;
      if (Math.abs(s.target - newScale) < 0.001 && Math.abs(newVelocity) < 0.001) {
        if (s.scale !== s.target) {
          setState({ scale: s.target, target: s.target, velocity: 0 });
        }
        rafRef.current = null;
        return;
      } else {
        setState({ scale: newScale, target: s.target, velocity: newVelocity });
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [state.target]);

  return {
    scale: state.scale,
    targetScale: state.target,
    zoomIn,
    zoomOut,
    reset,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    isZoomed: state.scale > 1.05,
  };
}
