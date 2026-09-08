/**
 * PWA install helpers — detection of platform/installed state and the
 * Chromium-only `beforeinstallprompt` flow.
 *
 * Facts this module is built on (MDN / web.dev, verified Sep 2026):
 *  - `beforeinstallprompt` fires only in Chromium browsers (Android/desktop);
 *    it is NOT supported on iOS/iPadOS — there installation is manual via
 *    Safari's «Поделиться» → «На экран “Домой”».
 *  - Installed state is detected with the CSS display-mode media query
 *    (`(display-mode: standalone)`) plus the iOS-proprietary
 *    `navigator.standalone` flag.
 *  - Since iPadOS 13, Safari on iPad reports itself as macOS: the only
 *    reliable distinction is `navigator.maxTouchPoints > 1`.
 *
 * Everything that needs unit testing is a pure function taking explicit
 * inputs; thin runtime wrappers read the real browser environment.
 */

export type InstallPlatform = "ios" | "ipados" | "android" | "desktop";

/** Explicit device fingerprint for testable platform detection. */
export interface DeviceFingerprint {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/** Minimal shape of the Chromium `beforeinstallprompt` event we rely on. */
export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Classify the current device for the install guide.
 * Pure — pass a fingerprint in tests; runtime calls use `navigator`.
 */
export function detectInstallPlatform(fp?: DeviceFingerprint): InstallPlatform {
  const ua = fp?.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const platform =
    fp?.platform ?? (typeof navigator !== "undefined" ? navigator.platform : "");
  const touch =
    fp?.maxTouchPoints ?? (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);

  if (/iphone|ipod/i.test(ua)) return "ios";
  if (/ipad/i.test(ua)) return "ipados";
  // iPadOS 13+ masquerades as macOS in both UA and platform — touch points
  // (>1) are the only dependable tell. A real Mac has maxTouchPoints 0.
  if (/mac/i.test(platform) && touch > 1) return "ipados";
  if (/mac/i.test(ua) && touch > 1) return "ipados";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

// ---------------------------------------------------------------------------
// Installed (standalone) state
// ---------------------------------------------------------------------------

/**
 * Pure standalone check: display-mode media queries (Chromium, Safari 17+)
 * plus the iOS-only `navigator.standalone` flag.
 */
export function isStandaloneDisplay(
  displayModeMatches: ((query: string) => boolean) | undefined,
  standaloneNavigator: boolean | undefined
): boolean {
  if (displayModeMatches) {
    if (displayModeMatches("(display-mode: standalone)")) return true;
    // minimal-ui is part of the installed fallback chain (display_override).
    if (displayModeMatches("(display-mode: minimal-ui)")) return true;
  }
  return standaloneNavigator === true;
}

/** Runtime wrapper — SSR-safe. */
export function isPwaInstalled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isStandaloneDisplay(
      (query) => window.matchMedia(query).matches,
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chromium native install prompt (beforeinstallprompt)
// ---------------------------------------------------------------------------

type InstallPromptListener = () => void;

let installPromptEvent: BeforeInstallPromptEventLike | null = null;
let installListenersRegistered = false;
const installPromptListeners = new Set<InstallPromptListener>();

function notifyInstallListeners() {
  for (const listener of installPromptListeners) listener();
}

/**
 * Attach global `beforeinstallprompt` / `appinstalled` listeners.
 * Idempotent — call from every component that cares about install state.
 * On iOS/iPadOS the event never fires, so nothing happens there.
 */
export function registerInstallPromptListener(): void {
  if (installListenersRegistered || typeof window === "undefined") return;
  installListenersRegistered = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Prevent Chromium's own mini-infobar; we show our own UI instead.
    event.preventDefault();
    installPromptEvent = event as BeforeInstallPromptEventLike;
    notifyInstallListeners();
  });
  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    notifyInstallListeners();
  });
}

/** Subscribe to prompt availability / install changes. Returns unsubscriber. */
export function onInstallPromptAvailable(listener: InstallPromptListener): () => void {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
}

/** The captured native prompt event, if the browser offered one. */
export function getInstallPromptEvent(): BeforeInstallPromptEventLike | null {
  return installPromptEvent;
}

/**
 * Trigger the native Chromium install dialog. Must be called from a user
 * gesture (button click). The event is single-use — consumed either way.
 */
export async function promptNativeInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = installPromptEvent;
  if (!event) return "unavailable";
  installPromptEvent = null;
  try {
    const choice = await event.prompt();
    return choice?.outcome ?? "dismissed";
  } catch {
    return "dismissed";
  }
}

// ---------------------------------------------------------------------------
// One-time hint visibility
// ---------------------------------------------------------------------------

export const INSTALL_HINT_DISMISS_KEY = "doma:install-hint-dismissed-at";
export const INSTALL_HINT_ENGAGED_KEY = "doma:install-hint-engaged";
/** How long a simple dismissal hides the hint. */
export const INSTALL_HINT_SNOOZE_DAYS = 30;
/** A user who engaged with the guide sees it far less often. */
export const INSTALL_HINT_ENGAGED_SNOOZE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure visibility rule for the unobtrusive install hint: mobile only,
 * not already installed, honouring the snooze window.
 */
export function shouldShowInstallHint(input: {
  platform: InstallPlatform;
  installed: boolean;
  dismissedAt: number | null;
  engaged: boolean;
  now?: number;
}): boolean {
  if (input.platform === "desktop") return false;
  if (input.installed) return false;
  if (input.dismissedAt === null) return true;
  const now = input.now ?? Date.now();
  const snoozeDays = input.engaged
    ? INSTALL_HINT_ENGAGED_SNOOZE_DAYS
    : INSTALL_HINT_SNOOZE_DAYS;
  return now - input.dismissedAt >= snoozeDays * DAY_MS;
}

/** Runtime snapshot used by the hint component. */
export interface InstallHintState {
  platform: InstallPlatform;
  installed: boolean;
  canNativePrompt: boolean;
  shouldShow: boolean;
}

export function getInstallHintState(): InstallHintState {
  const platform = detectInstallPlatform();
  const installed = isPwaInstalled();
  let dismissedAt: number | null = null;
  let engaged = false;
  try {
    const raw = window.localStorage.getItem(INSTALL_HINT_DISMISS_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      dismissedAt = Number.isFinite(parsed) ? parsed : null;
    }
    engaged = window.localStorage.getItem(INSTALL_HINT_ENGAGED_KEY) === "1";
  } catch {
    // Storage unavailable (private mode etc.) — treat as never dismissed.
  }
  return {
    platform,
    installed,
    canNativePrompt: getInstallPromptEvent() !== null,
    shouldShow: shouldShowInstallHint({ platform, installed, dismissedAt, engaged }),
  };
}

/** Hide the hint for the regular snooze window. */
export function snoozeInstallHint(): void {
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** The user engaged with the guide — hide the hint for a long time. */
export function markInstallHintEngaged(): void {
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISS_KEY, String(Date.now()));
    window.localStorage.setItem(INSTALL_HINT_ENGAGED_KEY, "1");
  } catch {
    // ignore
  }
}