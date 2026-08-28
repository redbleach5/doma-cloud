"use client";

import * as React from "react";
import type { FileItem } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import { FileIcon } from "@/components/cloud/file-icon";
import { isThumbnailableImage } from "@/lib/cloud/image-display";
import { cn } from "@/lib/utils";

type ThumbSize = 64 | 128 | 256 | 512 | 1024 | 2048;

interface Props {
  item: FileItem;
  size: ThumbSize;
  /** When false, always render the typed icon (e.g. trash view). */
  enabled?: boolean;
  /** Optional share token for public / shared-view thumbs. */
  token?: string;
  className?: string;
  imgClassName?: string;
  iconClassName?: string;
  alt?: string;
}

/**
 * Image thumbnail with icon fallback.
 * Failures (404/500 from sharp, broken HEIC, network) must never leave a
 * broken-image glyph — fall back to the typed FileIcon instead.
 */
export function FileThumb({
  item,
  size,
  enabled = true,
  token,
  className,
  imgClassName,
  iconClassName,
  alt,
}: Props) {
  const eligible =
    enabled &&
    !item.isDirectory &&
    item.category === "image" &&
    isThumbnailableImage(item.mimeType);

    const [failed, setFailed] = React.useState(false);
  const src = eligible ? api.thumbnailUrl(item.id, size, token) : null;

  // Reset "failed" when navigating to another file with the same component
  // instance — done during render (prop-change adjustment) so we never call
  // setState synchronously at the top of an effect.
  const thumbKey = `${item.id}|${src ?? ""}`;
  const [loadedThumbKey, setLoadedThumbKey] = React.useState(thumbKey);
  if (loadedThumbKey !== thumbKey) {
    setLoadedThumbKey(thumbKey);
    setFailed(false);
  }


  if (!src || failed) {
    return <FileIcon item={item} className={iconClassName} />;
  }

  return (
    // Wrapper keeps layout stable when falling back to icon.
    <span className={cn("contents", className)}>
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        className={imgClassName}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
