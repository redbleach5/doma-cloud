/**
 * Mock helpers for Next.js server-only APIs that read from request context.
 *
 * The trickiest part of testing Next.js App Router API routes is that
 * `cookies()` from `next/headers` reads from an AsyncLocalStorage context
 * that only exists during an actual HTTP request. Calling `cookies()` from
 * a unit test throws "Dynamic server usage: cookies() was called outside of
 * a request scope".
 *
 * Solution: use Bun's `mock.module()` to replace `next/headers` with a
 * shim that returns a configurable in-memory cookie store. Tests can then
 * call `setMockCookies({ doma_session: "..." })` before invoking a route
 * handler, and assert on the cookies set by the handler via
 * `getMockCookies()`.
 *
 * ISOLATION: The cookie store uses AsyncLocalStorage so that parallel test
 * files (or even parallel tests within a file) each get their own isolated
 * store. Without this, one test file's `resetMockCookies()` would wipe
 * cookies that another file just set.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { mock } from "bun:test";

// In-memory cookie store, scoped per async context (per test).
interface MockCookie {
  value: string;
  options?: Record<string, unknown>;
}

const cookieStore = new AsyncLocalStorage<Map<string, MockCookie>>();

/** Get the current context's cookie map (creating a root one if needed). */
function currentStore(): Map<string, MockCookie> {
  let store = cookieStore.getStore();
  if (!store) {
    // No context — use a fallback global map. This happens when the mock
    // is called outside of a test wrapper (e.g. during module init).
    store = globalStore;
  }
  return store;
}

// Fallback global store for calls outside any test context.
const globalStore = new Map<string, MockCookie>();

/**
 * Run a callback in an isolated cookie-store context. Call this in
 * `beforeEach` (or wrap individual test bodies) so each test gets its own
 * cookie store that can't leak into other tests.
 */
export function withIsolatedCookieStore<T>(fn: () => Promise<T> | T): Promise<T> | T {
  return cookieStore.run(new Map(), fn);
}

/** Reset the current context's cookie store. Call in `beforeEach`. */
export function resetMockCookies(): void {
  const store = cookieStore.getStore();
  if (store) {
    store.clear();
  } else {
    globalStore.clear();
  }
}

/** Pre-populate the current context's cookie store. */
export function setMockCookies(cookies: Record<string, string>): void {
  const store = currentStore();
  for (const [name, value] of Object.entries(cookies)) {
    store.set(name, { value });
  }
}

/** Read all cookies in the current context. */
export function getMockCookies(): Record<string, string> {
  const store = currentStore();
  const out: Record<string, string> = {};
  for (const [name, c] of store) out[name] = c.value;
  return out;
}

/** Read a single cookie value (or undefined). */
export function getMockCookie(name: string): string | undefined {
  return currentStore().get(name)?.value;
}

/**
 * Install the `next/headers` mock. Call ONCE at the top of the test file
 * (or in a setup file) — Bun's `mock.module` is idempotent.
 */
export function installNextHeadersMock(): void {
  mock.module("next/headers", () => ({
    cookies: async () => {
      const store = currentStore();
      return {
        get: (name: string) => {
          const c = store.get(name);
          return c ? { name, value: c.value } : undefined;
        },
        getAll: () =>
          Array.from(store.entries()).map(([name, c]) => ({ name, value: c.value })),
        set: (name: string, value: string, options?: Record<string, unknown>) => {
          store.set(name, { value, options });
        },
        delete: (name: string) => {
          store.delete(name);
        },
        has: (name: string) => store.has(name),
      };
    },
    headers: async () => new Map<string, string>(),
  }));
}
