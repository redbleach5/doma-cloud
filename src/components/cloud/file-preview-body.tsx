"use client";

import * as React from "react";
import type { PreviewableFile } from "@/lib/cloud/api";
import { api } from "@/lib/cloud/api";
import { cn } from "@/lib/utils";
import { Download, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpringZoom } from "@/components/cloud/use-spring-zoom";
import {
  imageDisplayMode,
  IMAGE_PREVIEW_THUMB_SIZE,
} from "@/lib/cloud/image-display";

export type { PreviewableFile };

/**
 * Shared preview body — used by both the in-app FilePreviewDialog and the
 * public share page. Renders the best viewer for the file category.
 *
 * `shareToken` is required when opening from `/s/[token]` so transcoded
 * image previews (HEIC → JPEG thumb) can authorize against the share.
 */
export function FilePreviewBody({
  item,
  url,
  shareToken,
}: {
  item: PreviewableFile;
  url: string;
  shareToken?: string;
}) {
  switch (item.category) {
    case "image":
      return (
        <ImagePreview
          item={item}
          downloadUrl={url}
          shareToken={shareToken}
        />
      );
    case "video":
      return <VideoPreview url={url} mimeType={item.mimeType} />;
    case "audio":
      return <AudioPreview url={url} name={item.name} mimeType={item.mimeType} />;
    case "pdf":
      return <PdfPreview url={url} />;
    case "text":
    case "markdown":
    case "code":
      return <TextPreview url={url} category={item.category} name={item.name} />;
    default:
      return <UnsupportedPreview name={item.name} mimeType={item.mimeType} url={url} />;
  }
}

function ImagePreview({
  item,
  downloadUrl,
  shareToken,
}: {
  item: PreviewableFile;
  downloadUrl: string;
  shareToken?: string;
}) {
  const mode = imageDisplayMode(item.mimeType);
  const displayUrl =
    mode === "native"
      ? downloadUrl
      : mode === "transcoded"
        ? api.thumbnailUrl(item.id, IMAGE_PREVIEW_THUMB_SIZE, shareToken)
        : null;

                const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
          displayUrl ? "loading" : "error"
        );


  // Adjust state during render when the displayed URL/item changes (React's
  // "adjusting state when a prop changes" pattern - no synchronous setState
  // at the top of an effect).

  const statusKey = `${item.id}|${displayUrl ?? ""}`;
  const [loadedKey, setLoadedKey] = React.useState(statusKey);
  if (loadedKey !== statusKey) {
    setLoadedKey(statusKey);
    setStatus(displayUrl ? "loading" : "error");
  }


  const zoom = useSpringZoom();
  const imgRef = React.useRef<HTMLImageElement>(null);

  // Attach wheel listener (passive: false to allow preventDefault).
  React.useEffect(() => {
    const el = imgRef.current?.parentElement;
    if (!el || status !== "ready") return;
    el.addEventListener("wheel", zoom.onWheel, { passive: false });
    el.addEventListener("touchstart", zoom.onTouchStart, { passive: false });
    el.addEventListener("touchmove", zoom.onTouchMove, { passive: false });
    el.addEventListener("touchend", zoom.onTouchEnd);
    return () => {
      el.removeEventListener("wheel", zoom.onWheel);
      el.removeEventListener("touchstart", zoom.onTouchStart);
      el.removeEventListener("touchmove", zoom.onTouchMove);
      el.removeEventListener("touchend", zoom.onTouchEnd);
    };
  }, [zoom, status]);

  if (!displayUrl || status === "error") {
    return (
      <UnsupportedPreview
        name={item.name}
        mimeType={item.mimeType}
        url={downloadUrl}
        hint={
          mode === "transcoded"
            ? "Не удалось показать превью. Можно скачать оригинал."
            : undefined
        }
      />
    );
  }

  return (
    <div
      data-testid="image-preview"
      className={cn(
        "w-full h-full flex items-center justify-center p-4 select-none relative",
        zoom.isZoomed ? "cursor-zoom-out overflow-auto" : "cursor-zoom-in"
      )}
      onClick={() => {
        if (status !== "ready") return;
        if (zoom.isZoomed) zoom.reset();
        else zoom.zoomIn();
      }}
    >
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-label="Загрузка превью" />
        </div>
      )}
      <img
        ref={imgRef}
        data-testid="image-preview-img"
        src={displayUrl}
        alt={item.name}
        className={cn(
          "max-w-full max-h-full object-contain rounded-lg shadow-2xl shadow-primary/10 transition-opacity",
          status === "ready" ? "opacity-100" : "opacity-0"
        )}
        style={{ transform: `scale(${zoom.scale})`, transformOrigin: "center center" }}
        draggable={false}
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />

      {/* Zoom controls overlay */}
      {status === "ready" && zoom.targetScale > 1.05 && (
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/80 backdrop-blur-md rounded-full px-2 py-1 shadow-lg border border-border/40">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); zoom.zoomOut(); }}
            className="h-10 w-10 rounded-full hover:bg-muted flex items-center justify-center text-base"
            aria-label="Уменьшить"
          >−</button>
          <span className="text-xs tabular-nums w-12 text-center">
            {Math.round(zoom.targetScale * 100)}%
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); zoom.zoomIn(); }}
            className="h-10 w-10 rounded-full hover:bg-muted flex items-center justify-center text-base"
            aria-label="Увеличить"
          >+</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); zoom.reset(); }}
            className="h-10 px-3 rounded-full hover:bg-muted flex items-center justify-center text-xs"
            aria-label="Сбросить"
          >1:1</button>
        </div>
      )}
    </div>
  );
}

/**
 * Браузеры могут воспроизводить только определённые видеоформаты.
 * Эта функция проверяет, поддерживает ли браузер данный MIME-тип.
 * Для неподдерживаемых форматов показываем сообщение вместо пустого экрана.
 */
function isBrowserPlayableVideo(mimeType: string): boolean {
  // Нормализуем MIME-тип
  const normalized = (mimeType ?? "").toLowerCase().split(";")[0].trim();

  // Форматы, которые большинство современных браузеров поддерживают
  const PLAYABLE_VIDEO_TYPES = new Set([
    "video/mp4",      // H.264/AAC — самый поддерживаемый формат
    "video/webm",     // VP8/VP9 + Vorbis/Opus
    "video/ogg",      // Theora + Vorbis
  ]);

  // Быстрая проверка по известным типам
  if (PLAYABLE_VIDEO_TYPES.has(normalized)) return true;

  // Для остальных форматов проверяем через API браузера (если доступно)
  if (typeof document === "undefined") return false;

  const video = document.createElement("video");
  const canPlay = video.canPlayType(normalized);

  // canPlayType возвращает: "probably", "maybe", или "" (пустая строка = не поддерживается)
  return canPlay === "probably" || canPlay === "maybe";
}

function VideoPreview({ url, mimeType }: { url: string; mimeType: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const playable = isBrowserPlayableVideo(mimeType);

  // Pause the video when the component unmounts. Without this, the audio
  // track keeps playing in the background after the user closes the preview
  // dialog (especially on Safari/iOS).
  React.useEffect(() => {
    const el = ref.current;
    return () => {
      el?.pause();
      el?.removeAttribute("src");
      el?.load();
    };
  }, []);

  // Если формат не поддерживается браузером, показываем сообщение
  if (!playable) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center" data-testid="video-unsupported">
        <div className="h-24 w-24 rounded-3xl bg-muted/60 flex items-center justify-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        </div>
        <div>
          <div className="font-medium">Видео не может быть воспроизведено</div>
          <div className="text-sm text-muted-foreground mt-1">
            Формат {mimeType} не поддерживается браузером.
            Скачайте файл для просмотра в плеере.
          </div>
        </div>
        <Button asChild>
          <a href={url} download>
            <Download className="h-4 w-4 mr-2" />
            Скачать
          </a>
        </Button>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={url}
      controls
      autoPlay
      muted
      className="max-w-full max-h-full rounded-lg shadow-lg bg-black"
      playsInline
      onError={() => {
        const videoEl = ref.current;
        const errorMsg = videoEl?.error?.message || "Не удалось загрузить видео";
        setError(errorMsg);
      }}
    >
      <source src={url} type={mimeType} />
    </video>
  );
}

function AudioPreview({ url, name, mimeType }: { url: string; name: string; mimeType: string }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    return () => {
      el?.pause();
      el?.removeAttribute("src");
      el?.load();
    };
  }, []);
  return (
    <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full">
      <div className="h-48 w-48 rounded-3xl bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center shadow-inner ring-4 ring-primary/10">
        <svg viewBox="0 0 24 24" className="h-24 w-24 text-primary" fill="currentColor" aria-hidden>
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
      <div className="text-center">
        <div className="font-medium text-lg truncate" title={name}>{name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{mimeType}</div>
      </div>
      <audio ref={ref} src={url} controls className="w-full">
        <source src={url} type={mimeType} />
      </audio>
    </div>
  );
}

function PdfPreview({ url }: { url: string }) {
  return (
    <iframe src={url} title="PDF preview" className="w-full h-full border-0 bg-white" />
  );
}

function TextPreview({ url, category, name }: { url: string; category: string; name: string }) {
  const [content, setContent] = React.useState<string | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);

  // Reset derived state whenever the source URL changes — done in render
  // phase (React's "adjusting state when a prop changes" pattern) so we
  // never call setState synchronously at the top of an effect.
  const [loadedUrl, setLoadedUrl] = React.useState(url);
  if (loadedUrl !== url) {
    setLoadedUrl(url);
    setContent(null);
    setError(null);
    setTruncated(false);
  }

  React.useEffect(() => {
    // Use AbortController so the fetch is actually cancelled when the user
    // closes the preview. The previous `cancelled` flag only prevented
    // setState-after-unmount — the network request kept going, wasting
    // bandwidth for large text files.
    //
    // Size cap: text files > TEXT_PREVIEW_MAX_BYTES are read only up to the
    // cap and shown with a "truncated" notice. Without this, opening a
    // 100 MB .log file would pull the whole thing into memory and render it
    // into a <pre>, which can crash the tab.
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })

      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить");
        return r.blob();
      })
      .then(async (blob) => {
        if (blob.size > TEXT_PREVIEW_MAX_BYTES) {
          setTruncated(true);
          const slice = blob.slice(0, TEXT_PREVIEW_MAX_BYTES);
          return slice.text();
        }
        return blob.text();
      })
      .then((txt) => setContent(txt))
      .catch((e) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Ошибка");
      });
    return () => controller.abort();
  }, [url]);

  if (error) return <div className="text-destructive p-4">{error}</div>;
  if (content === null) return <div className="text-muted-foreground p-4">Загрузка…</div>;

  if (category === "markdown") {
    return (
      <div className="w-full h-full overflow-auto">
        {truncated && <TruncationNotice name={name} />}
        <MarkdownPreview source={content} />
      </div>
    );
  }

  if (category === "code") {
    return (
      <div className="w-full h-full overflow-auto">
        {truncated && <TruncationNotice name={name} />}
        <pre className="text-xs leading-relaxed p-4 font-mono bg-card/50">
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto">
      {truncated && <TruncationNotice name={name} />}
      <div className="p-6 max-w-3xl mx-auto">
        <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{content}</pre>
      </div>
    </div>
  );
}

/** Hard cap on the number of bytes we pull into a TextPreview.
 *  1 MB is enough for typical config files, source files, READMEs;
 *  anything bigger is almost certainly a log or data dump that
 *  shouldn't be opened inline anyway. */
const TEXT_PREVIEW_MAX_BYTES = 1 * 1024 * 1024;

function TruncationNotice({ name }: { name: string }) {
  return (
    <div className="px-4 py-2 bg-chart-4/10 border-b border-chart-4/30 text-xs text-accent-foreground flex items-center gap-2">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-chart-4" />
      <span>
        Файл «{name}» слишком большой для предпросмотра целиком — показаны
        первые {Math.round(TEXT_PREVIEW_MAX_BYTES / 1024)} КБ. Скачайте файл,
        чтобы увидеть содержимое полностью.
      </span>
    </div>
  );
}

// Hoisted to module scope: React.lazy must return a STABLE component type
// across renders. Declaring it inside the component body created a new lazy
// type on every render, causing React to remount the subtree, re-trigger
// the dynamic import, and flash the Suspense fallback every time.
const ReactMarkdown = React.lazy(() => import("react-markdown"));

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="w-full h-full overflow-auto p-6 max-w-3xl mx-auto prose prose-sm dark:prose-invert max-w-none">
      <React.Suspense fallback={<div className="text-muted-foreground">Загрузка…</div>}>
        <ReactMarkdown>{source}</ReactMarkdown>
      </React.Suspense>
    </div>
  );
}

/**
 * Возвращает подсказку о почему формат не поддерживается
 * и что можно сделать в качестве альтернативы.
 */
function getUnsupportedFormatHint(mimeType: string): string {
  const lower = (mimeType ?? "").toLowerCase().split(";")[0].trim();

  // Видеоформаты, которые не поддерживаются браузером
  if (lower.startsWith("video/") && !["video/mp4", "video/webm", "video/ogg"].includes(lower)) {
    return `Формат ${mimeType} не поддерживается браузером. Скачайте файл для просмотра в видеоплеере (VLC, MPC-HC и т.д.).`;
  }

  // Аудиоформаты без поддержки
  if (lower.startsWith("audio/") && !["audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm", "audio/aac"].includes(lower)) {
    return `Формат ${mimeType} не поддерживается браузером. Скачайте файл для прослушивания в аудиоплеере.`;
  }

  // Архивы
  if (["application/zip", "application/x-rar-compressed", "application/x-7z-compressed", "application/gzip", "application/x-tar"].includes(lower)) {
    return `Архивы нельзя просмотреть в браузере. Скачайте файл и распакуйте его.`;
  }

  // Исполняемые файлы
  if (["application/x-executable", "application/x-msdownload", "application/x-dosexec"].includes(lower)) {
    return `Исполняемые файлы нельзя открыть в браузере. Скачайте файл для запуска на компьютере.`;
  }

  // Документы Office (без поддержки просмотра)
  if ([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
  ].includes(lower)) {
    return `Формат ${mimeType} не поддерживается для просмотра. Скачайте файл для открытия в соответствующей программе.`;
  }

  // Общий случай
  return `Этот тип файла нельзя открыть в браузере (${mimeType}). Скачайте файл для просмотра.`;
}

function UnsupportedPreview({
  name,
  mimeType,
  url,
  hint,
}: {
  name: string;
  mimeType: string;
  url: string;
  hint?: string;
}) {
  const ext = name.split(".").pop()?.toUpperCase() ?? "FILE";

  // Используем переданную подсказку или генерируем автоматически
  const displayHint = hint ?? getUnsupportedFormatHint(mimeType);

  return (
    <div className="flex flex-col items-center gap-4 p-8 text-center" data-testid="preview-unsupported">
      <div className="h-24 w-24 rounded-3xl bg-muted/60 flex items-center justify-center">
        <span className="text-2xl font-bold text-muted-foreground">{ext}</span>
      </div>
      <div>
        <div className="font-medium">{name}</div>
        <div className="text-sm text-muted-foreground mt-1 max-w-sm">
          {displayHint}
        </div>
      </div>
      <Button asChild>
        <a href={url} download={name}>
          <Download className="h-4 w-4 mr-2" />
          Скачать
        </a>
      </Button>
    </div>
  );
}
