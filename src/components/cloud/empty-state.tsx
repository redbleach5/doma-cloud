"use client";

import { UploadCloud, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  view: "files" | "trash";
  onUploadClick: () => void;
}

export function EmptyState({ view, onUploadClick }: Props) {
  if (view === "trash") {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-4">
        <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
          <Trash2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Корзина пуста</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          Удалённые файлы появятся здесь. Через 30 дней они будут стёрты навсегда.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-4">
      {/* Floating particle — a single warm mote drifting in the void.
          Hints "this space is waiting for your memories". */}
      <div className="relative h-32 w-32 mb-2">
        <div
          className="absolute top-1/2 left-1/2 h-2 w-2 rounded-full bg-primary/60"
          style={{
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 16px 4px oklch(0.78 0.18 65 / 0.4)",
            animation: "doma-empty-drift 4s ease-in-out infinite",
          }}
        />
        <div
          className="absolute top-1/3 left-2/3 h-1 w-1 rounded-full bg-primary/40"
          style={{ animation: "doma-empty-drift 5s ease-in-out infinite 0.5s" }}
        />
        <div
          className="absolute bottom-1/4 right-1/3 h-1.5 w-1.5 rounded-full bg-primary/30"
          style={{ animation: "doma-empty-drift 6s ease-in-out infinite 1s" }}
        />
      </div>

      <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5 ring-4 ring-primary/5 doma-warm-glow">
        <UploadCloud className="h-10 w-10 text-primary" />
      </div>
      <h3 className="text-xl font-semibold mb-2">Здесь пока пусто</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Перетащите файлы сюда или нажмите кнопку, чтобы загрузить первые фото,
        видео или документы.
      </p>
      <Button onClick={onUploadClick} size="lg" className="gap-2 shadow-sm doma-warm-glow">
        <UploadCloud className="h-4 w-4" />
        Загрузить файлы
      </Button>

      <style jsx>{`
        @keyframes doma-empty-drift {
          0%, 100% {
            transform: translate(-50%, -50%) translateY(0);
            opacity: 0.6;
          }
          50% {
            transform: translate(-50%, -50%) translateY(-12px);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
