/**
 * Share-viewer cookie helpers — shared between the share-verify route,
 * the download route, and the thumbnail route.
 *
 * When a user successfully verifies a share's password, we set a short-lived
 * cookie on the response so subsequent requests (download, thumbnail) for
 * the SAME share token don't re-prompt for the password.
 *
 * When a share has a view cap (`maxViews` / `oneTimeUse`), POST /api/share/[token]
 * increments `usedCount` and sets `doma_svd_*` ("viewed"). Download/thumbnail
 * require that cookie so callers cannot bypass the view limit with a direct URL.
 */

import { createHash } from "node:crypto";

/** Build the cookie-key suffix used to mark a share as password-verified / viewed. */
export function shareCookieHashSuffix(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/** Cookie set after successful password verification. */
export function shareVerifiedCookieKey(token: string): string {
  return `doma_sv_${shareCookieHashSuffix(token)}`;
}

/** Cookie set after a successful share verify (view slot granted). */
export function shareViewedCookieKey(token: string): string {
  return `doma_svd_${shareCookieHashSuffix(token)}`;
}

/** Same cap semantics as POST /api/share/[token]. */
export function shareEffectiveMaxViews(share: {
  oneTimeUse: boolean;
  maxViews: number | null;
}): number | null {
  return share.oneTimeUse ? (share.maxViews ?? 1) : share.maxViews;
}

/**
 * For capped shares, require the `doma_svd_*` cookie issued by verify.
 * Returns an error payload, or null when download/thumbnail may proceed.
 */
export function shareViewGrantError(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  share: { token: string; oneTimeUse: boolean; maxViews: number | null }
): { status: number; body: { error: string; needsVerify: boolean } } | null {
  if (shareEffectiveMaxViews(share) === null) return null;
  if (req.cookies.get(shareViewedCookieKey(share.token))?.value === "1") {
    return null;
  }
  return {
    status: 403,
    body: {
      error: "Сначала откройте ссылку в браузере",
      needsVerify: true,
    },
  };
}
