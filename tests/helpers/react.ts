/**
 * React test setup helpers.
 *
 * The actual DOM installation (happy-dom) happens in `tests/preload.ts` so
 * that `@testing-library/dom`'s `screen` object captures the happy-dom
 * document at import time.
 *
 * This module provides convenience helpers for resetting the DOM between
 * tests and (optionally) tearing it down at the end.
 */

/**
 * Clear all rendered components and reset document state.
 * Call in `afterEach` so each test starts with a clean DOM.
 */
export function resetDom(): void {
  if (typeof document !== "undefined" && document.body) {
    document.body.innerHTML = "";
  }
}

/**
 * No-op in the current setup (the DOM lives for the whole process).
 * Kept for API symmetry with `setupDom()` in case we ever switch to
 * per-test Window instances.
 */
export function setupDom(): void {
  // The DOM is installed in preload.ts. Nothing to do here.
}

/**
 * No-op in the current setup. Kept for API symmetry.
 */
export function teardownDom(): void {
  // We keep the DOM alive for the whole process.
}
