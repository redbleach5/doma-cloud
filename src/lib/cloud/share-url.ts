/**
 * Share / copy helpers that work on LAN HTTP (non-secure context).
 *
 * `navigator.clipboard` is often blocked on `http://192.168…` (Safari/Chrome
 * require a secure context). `navigator.share` is the preferred mobile path.
 */

import { BRAND_NAME } from "@/lib/cloud/brand";

/** Copy text; returns false if both Clipboard API and execCommand fail. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      // Skip when not secure — writeText often rejects and some browsers
      // leave the clipboard untouched without a clear error.
      if (window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to execCommand
    }
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export type ShareUrlResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Prefer the OS share sheet on mobile; otherwise copy to clipboard.
 * `cancelled` = user dismissed the share sheet (link still exists).
 */
export async function shareOrCopyUrl(
  url: string,
  title?: string
): Promise<ShareUrlResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: title || BRAND_NAME, url, text: title });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return "cancelled";
      }
      // Share unsupported for this payload — try copy.
    }
  }

  const ok = await copyText(url);
  return ok ? "copied" : "failed";
}
