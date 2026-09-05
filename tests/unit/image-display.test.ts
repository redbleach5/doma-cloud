import { describe, expect, it } from "bun:test";
import {
  imageDisplayMode,
  isBrowserNativeImage,
  isThumbnailableImage,
  IMAGE_PREVIEW_THUMB_SIZE,
} from "@/lib/cloud/image-display";

describe("isBrowserNativeImage", () => {
  it("accepts common web formats", () => {
    expect(isBrowserNativeImage("image/jpeg")).toBe(true);
    expect(isBrowserNativeImage("image/png")).toBe(true);
    expect(isBrowserNativeImage("image/gif")).toBe(true);
    expect(isBrowserNativeImage("image/webp")).toBe(true);
    expect(isBrowserNativeImage("image/avif")).toBe(true);
  });

  it("strips parameters and ignores case", () => {
    expect(isBrowserNativeImage("IMAGE/JPEG; charset=binary")).toBe(true);
  });

  it("rejects phone camera / document formats that need transcoding", () => {
    expect(isBrowserNativeImage("image/heic")).toBe(false);
    expect(isBrowserNativeImage("image/heif")).toBe(false);
    expect(isBrowserNativeImage("image/tiff")).toBe(false);
    expect(isBrowserNativeImage("image/svg+xml")).toBe(false);
  });
});

describe("isThumbnailableImage", () => {
  it("is true for any image/* including HEIC and SVG", () => {
    expect(isThumbnailableImage("image/heic")).toBe(true);
    expect(isThumbnailableImage("image/svg+xml")).toBe(true);
    expect(isThumbnailableImage("image/jpeg")).toBe(true);
  });

  it("is false for non-images", () => {
    expect(isThumbnailableImage("application/pdf")).toBe(false);
    expect(isThumbnailableImage("text/plain")).toBe(false);
  });
});

describe("imageDisplayMode", () => {
  it("uses native for jpeg/png", () => {
    expect(imageDisplayMode("image/jpeg")).toBe("native");
    expect(imageDisplayMode("image/png")).toBe("native");
  });

  it("transcodes HEIC/HEIF/SVG/TIFF for <img> safety", () => {
    expect(imageDisplayMode("image/heic")).toBe("transcoded");
    expect(imageDisplayMode("image/heif")).toBe("transcoded");
    expect(imageDisplayMode("image/svg+xml")).toBe("transcoded");
    expect(imageDisplayMode("image/tiff")).toBe("transcoded");
  });

  it("marks non-images unsupported", () => {
    expect(imageDisplayMode("application/pdf")).toBe("unsupported");
  });
});

describe("IMAGE_PREVIEW_THUMB_SIZE", () => {
  it("is large enough for full-screen preview", () => {
    expect(IMAGE_PREVIEW_THUMB_SIZE).toBe(2048);
  });
});
