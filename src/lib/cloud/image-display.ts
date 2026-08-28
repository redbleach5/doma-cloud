/**
 * Browser vs server image display strategy.
 *
 * Family uploads often include HEIC (iPhone) and occasional SVG/TIFF.
 * Only a small set of MIME types can safely drive `<img src={downloadUrl}>`
 * (inline Content-Disposition + browser decode). Everything else that is still
 * `image/*` should be served as a sharp-transcoded JPEG thumbnail.
 */

const BROWSER_NATIVE_IMAGE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

function normalizeMime(mime: string): string {
  return (mime ?? "").toLowerCase().split(";")[0]!.trim();
}

/** True when the raw download URL is safe/usable inside `<img>`. */
export function isBrowserNativeImage(mime: string): boolean {
  return BROWSER_NATIVE_IMAGE.has(normalizeMime(mime));
}

/**
 * Images we will attempt to rasterize via `/api/files/thumbnail`.
 * Non-image MIME types return false. SVG is included so grid/preview can
 * show a JPEG raster instead of the attachment-forced download response.
 */
export function isThumbnailableImage(mime: string): boolean {
  const lower = normalizeMime(mime);
  return lower.startsWith("image/");
}

export type ImageDisplayMode = "native" | "transcoded" | "unsupported";

/**
 * How the UI should show this image:
 * - native — `<img src={downloadUrl}>`
 * - transcoded — `<img src={thumbnailUrl(1024|2048)}>` (HEIC, TIFF, SVG, …)
 * - unsupported — not an image MIME
 */
export function imageDisplayMode(mime: string): ImageDisplayMode {
  const lower = normalizeMime(mime);
  if (!lower.startsWith("image/")) return "unsupported";
  if (isBrowserNativeImage(lower)) return "native";
  return "transcoded";
}

/** Longest side used for full-screen / share transcoded previews. */
export const IMAGE_PREVIEW_THUMB_SIZE = 2048 as const;
