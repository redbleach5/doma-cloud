import { describe, expect, it } from "bun:test";
import {
  detectInstallPlatform,
  isStandaloneDisplay,
  shouldShowInstallHint,
  INSTALL_HINT_SNOOZE_DAYS,
  INSTALL_HINT_ENGAGED_SNOOZE_DAYS,
} from "@/lib/cloud/pwa-install";

const DAY = 24 * 60 * 60 * 1000;

describe("detectInstallPlatform", () => {
  const iPhoneUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const iPadUA =
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const iPadOS13PlusUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const macUA = iPadOS13PlusUA;
  const androidUA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const androidTabletUA =
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const windowsUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  it("detects iPhone (and iPod) as ios", () => {
    expect(
      detectInstallPlatform({ userAgent: iPhoneUA, platform: "iPhone", maxTouchPoints: 5 })
    ).toBe("ios");
  });

  it("detects old-UA iPad as ipados", () => {
    expect(
      detectInstallPlatform({ userAgent: iPadUA, platform: "iPad", maxTouchPoints: 5 })
    ).toBe("ipados");
  });

  it("detects iPadOS 13+ (reports itself as Mac) via touch points", () => {
    expect(
      detectInstallPlatform({ userAgent: iPadOS13PlusUA, platform: "MacIntel", maxTouchPoints: 5 })
    ).toBe("ipados");
    expect(
      detectInstallPlatform({ userAgent: iPadOS13PlusUA, platform: "MacIntel", maxTouchPoints: 2 })
    ).toBe("ipados");
  });

  it("keeps a real Mac (no touch) as desktop", () => {
    expect(
      detectInstallPlatform({ userAgent: macUA, platform: "MacIntel", maxTouchPoints: 0 })
    ).toBe("desktop");
    expect(
      detectInstallPlatform({ userAgent: macUA, platform: "MacIntel", maxTouchPoints: 1 })
    ).toBe("desktop");
  });

  it("detects Android phone and tablet as android", () => {
    expect(
      detectInstallPlatform({ userAgent: androidUA, platform: "Linux armv81", maxTouchPoints: 5 })
    ).toBe("android");
    expect(
      detectInstallPlatform({
        userAgent: androidTabletUA,
        platform: "Linux armv81",
        maxTouchPoints: 5,
      })
    ).toBe("android");
  });

  it("detects Windows as desktop", () => {
    expect(
      detectInstallPlatform({ userAgent: windowsUA, platform: "Win32", maxTouchPoints: 0 })
    ).toBe("desktop");
  });
});

describe("isStandaloneDisplay", () => {
  it("is true when (display-mode: standalone) matches", () => {
    expect(isStandaloneDisplay((q) => q === "(display-mode: standalone)", false)).toBe(true);
  });

  it("is true for the iOS-only navigator.standalone flag", () => {
    expect(isStandaloneDisplay(() => false, true)).toBe(true);
    expect(isStandaloneDisplay(undefined, true)).toBe(true);
  });

  it("is false in a regular browser tab", () => {
    expect(isStandaloneDisplay(() => false, false)).toBe(false);
    expect(isStandaloneDisplay(undefined, false)).toBe(false);
    expect(isStandaloneDisplay(undefined, undefined)).toBe(false);
  });
});

describe("shouldShowInstallHint", () => {
  const base = {
    platform: "android" as const,
    installed: false,
    dismissedAt: null,
    engaged: false,
  };

  it("shows on mobile when never dismissed", () => {
    expect(shouldShowInstallHint({ ...base })).toBe(true);
    expect(shouldShowInstallHint({ ...base, platform: "ios" as const })).toBe(true);
    expect(shouldShowInstallHint({ ...base, platform: "ipados" as const })).toBe(true);
  });

  it("never shows on desktop", () => {
    expect(shouldShowInstallHint({ ...base, platform: "desktop" as const })).toBe(false);
  });

  it("never shows when the app is already installed", () => {
    expect(shouldShowInstallHint({ ...base, installed: true })).toBe(false);
  });

  it("stays hidden within the snooze window", () => {
    const now = 1_000_000_000_000;
    expect(
      shouldShowInstallHint({
        ...base,
        dismissedAt: now - (INSTALL_HINT_SNOOZE_DAYS - 1) * DAY,
        now,
      })
    ).toBe(false);
    // Exactly at the boundary the hint returns.
    expect(
      shouldShowInstallHint({
        ...base,
        dismissedAt: now - INSTALL_HINT_SNOOZE_DAYS * DAY,
        now,
      })
    ).toBe(true);
  });

  it("uses the long snooze window after engagement", () => {
    const now = 1_000_000_000_000;
    const dismissedAt = now - (INSTALL_HINT_SNOOZE_DAYS + 10) * DAY;
    // Regular snooze would have expired, engaged one has not.
    expect(shouldShowInstallHint({ ...base, dismissedAt, engaged: false, now })).toBe(true);
    expect(shouldShowInstallHint({ ...base, dismissedAt, engaged: true, now })).toBe(false);
    expect(
      shouldShowInstallHint({
        ...base,
        dismissedAt: dismissedAt - INSTALL_HINT_ENGAGED_SNOOZE_DAYS * DAY,
        engaged: true,
        now,
      })
    ).toBe(true);
  });
});