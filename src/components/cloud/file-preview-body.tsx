"use client";

import * as React from "react";
import type { PreviewableFile } from "@/lib/cloud/api";
import { cn } from "@/lib/utils";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpringZoom } from "@/components/cloud/atmosphere/use-spring-zoom";

export type { PreviewableFile };

/**
 * Shared preview body — used by both the in-app FilePreviewDialog and the
 * public share page. Renders the best viewer for the file category.
 */
export function FilePreviewBody({ item, url }: { item: PreviewableFile; url: string }) {
  switch (item.category) {
    case "image":
      return <ImagePreview url={url} name={item.name} />;
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

function ImagePreview({ url, name }: { url: string; name: string }) {
  const zoom = useSpringZoom();
  const imgRef = React.useRef<HTMLImageElement>(null);

  // Attach wheel listener (passive: false to allow preventDefault).
  React.useEffect(() => {
    const el = imgRef.current?.parentElement;
    if (!el) return;
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
  }, [zoom]);

  return (
    <div
      className={cn(
        "w-full h-full flex items-center justify-center p-4 select-none relative",
        zoom.isZoomed ? "cursor-zoom-out overflow-auto" : "cursor-zoom-in"
      )}
      onClick={(e) => {
        // Click to zoom in if not zoomed, click to reset if zoomed.
        if (zoom.isZoomed) zoom.reset();
        else zoom.zoomIn();
      }}
    >
      <img
        ref={imgRef}
        src={url}
        alt={name}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl shadow-primary/10"
        style={{ transform: `scale(${zoom.scale})`, transformOrigin: "center center" }}
        draggable={false}
      />

      {/* Zoom controls overlay */}
      {zoom.targetScale > 1.05 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/80 backdrop-blur-md rounded-full px-2 py-1 shadow-lg border border-border/40">
          <button
            onClick={(e) => { e.stopPropagation(); zoom.zoomOut(); }}
            className="h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center text-sm"
            aria-label="Уменьшить"
          >−</button>
          <span className="text-xs tabular-nums w-12 text-center">
            {Math.round(zoom.targetScale * 100)}%
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); zoom.zoomIn(); }}
            className="h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center text-sm"
            aria-label="Увеличить"
          >+</button>
          <button
            onClick={(e) => { e.stopPropagation(); zoom.reset(); }}
            className="h-7 px-2 rounded-full hover:bg-muted flex items-center justify-center text-xs"
            aria-label="Сбросить"
          >1:1</button>
        </div>
      )}
    </div>
  );
}

function VideoPreview({ url, mimeType }: { url: string; mimeType: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  // Pause the video when the component unmounts. Without this, the audio
  // track keeps playing in the background after the user closes the preview
  // dialog (especially on Safari/iOS).
  React.useEffect(() => {
    return () => {
      ref.current?.pause();
      ref.current?.removeAttribute("src");
      ref.current?.load();
    };
  }, []);
  return (
    <video
      ref={ref}
      src={url}
      controls
      autoPlay
      className="max-w-full max-h-full rounded-lg shadow-lg bg-black"
      playsInline
    >
      <source src={url} type={mimeType} />
    </video>
  );
}

function AudioPreview({ url, name, mimeType }: { url: string; name: string; mimeType: string }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    return () => {
      ref.current?.pause();
      ref.current?.removeAttribute("src");
      ref.current?.load();
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
      <audio ref={ref} src={url} controls autoPlay className="w-full">
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

  React.useEffect(() => {
    // Use AbortController so the fetch is actually cancelled when the user
    // closes the preview. The previous `cancelled` flag only prevented
    // setState-after-unmount — the network request kept going, wasting
    // bandwidth for large text files.
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить");
        return r.text();
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
    return <MarkdownPreview source={content} />;
  }

  if (category === "code") {
    return (
      <div className="w-full h-full overflow-auto">
        <pre className="text-xs leading-relaxed p-4 font-mono bg-card/50">
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-6 max-w-3xl mx-auto">
      <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{content}</pre>
    </div>
  );
}

function MarkdownPreview({ source }: { source: string }) {
  const ReactMarkdown = React.lazy(() => import("react-markdown"));
  return (
    <div className="w-full h-full overflow-auto p-6 max-w-3xl mx-auto prose prose-sm dark:prose-invert max-w-none">
      <React.Suspense fallback={<div className="text-muted-foreground">Загрузка…</div>}>
        <ReactMarkdown>{source}</ReactMarkdown>
      </React.Suspense>
    </div>
  );
}

function UnsupportedPreview({ name, mimeType, url }: { name: string; mimeType: string; url: string }) {
  const ext = name.split(".").pop()?.toUpperCase() ?? "FILE";
  return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <div className="h-24 w-24 rounded-3xl bg-muted/60 flex items-center justify-center">
        <span className="text-2xl font-bold text-muted-foreground">{ext}</span>
      </div>
      <div>
        <div className="font-medium">{name}</div>
        <div className="text-sm text-muted-foreground mt-1">
          Этот тип файла нельзя открыть в браузере ({mimeType}).
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
