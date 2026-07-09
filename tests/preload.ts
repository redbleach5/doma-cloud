/**
 * Bun test preload script.
 *
 * Runs BEFORE any test file. Sets up:
 *   - Environment variables (DATABASE_URL, DOMA_JWT_SECRET, etc.)
 *   - Mock for `next/headers` (so `cookies()` works in tests)
 *
 * Listed in `bunfig.toml` as `preload = ["./tests/preload.ts"]`.
 */

// ---- Environment ----
// ALWAYS force the test DB to an absolute path under the project's prisma/
// directory. We MUST override any inherited DATABASE_URL (e.g. from a system
// shell profile) so tests never accidentally hit a real dev/prod DB.
import { resolve } from "node:path";
const PROJECT_ROOT = resolve(import.meta.dir, "..");
process.env.DATABASE_URL = `file:${PROJECT_ROOT}/prisma/test.db`;
// A fixed test secret — NOT the .env.example placeholder, so getSecret()
// doesn't throw or warn.
process.env.DOMA_JWT_SECRET = "test-secret-for-jwt-signing-please-ignore-32+chars";
process.env.NODE_ENV = "test";
process.env.STORAGE_LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT ?? "./storage-data-test";
process.env.STORAGE_DRIVER = "local";

// ---- Mock next/headers BEFORE any test imports code that uses it ----
// We must install the mock here (in preload) rather than in individual test
// files, because `mock.module` only affects modules imported AFTER the mock
// is installed. By doing it in preload we guarantee it runs first.
import { installNextHeadersMock } from "./helpers/mock-cookies";
installNextHeadersMock();

// ---- Pre-install happy-dom for React component tests ----
// `@testing-library/dom`'s `screen` object captures `document.body` at
// import time. If we wait until a test's `beforeEach` to install happy-dom,
// `screen` has already been captured with `document === undefined` and all
// queries throw "global document has to be available".
//
// By installing happy-dom here (in preload, before any test file imports
// testing-library), we ensure `screen` captures the happy-dom document.
import { Window } from "happy-dom";
const win = new Window();
// Cast through `unknown` to avoid TS complaining about missing Next.js-
// specific properties (like __NEXT_DATA__) on the global Window type.
const g = globalThis as unknown as Record<string, unknown>;
g.window = win as unknown as Window & typeof globalThis;
g.document = win.document as unknown as Document;
g.navigator = win.navigator as unknown as Navigator;
g.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
g.Element = win.Element as unknown as typeof Element;
g.Node = win.Node as unknown as typeof Node;
g.Event = win.Event as unknown as typeof Event;
g.CustomEvent = win.CustomEvent as unknown as typeof CustomEvent;
g.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
g.cancelAnimationFrame = ((id: number) =>
  clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
g.IS_REACT_ACT_ENVIRONMENT = true;
