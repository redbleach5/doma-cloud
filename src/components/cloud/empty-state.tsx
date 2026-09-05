"use client";

import { UploadCloud, Trash2, Users, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/cloud/plural";

export type EmptyStateView = "files" | "trash" | "shared-root" | "shared-folder";

interface Props {
  view: EmptyStateView;
  onUploadClick?: () => void;
  trashRetentionDays?: number;
  /** When true, show upload CTA inside an empty shared folder. */
  canUpload?: boolean;
}

function DriftMotifs() {
  return (
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
        style={{
          transform: "translate(-50%, -50%)",
          animation: "doma-empty-drift 5s ease-in-out infinite 0.5s",
        }}
      />
      <div
        className="absolute top-2/3 left-1/4 h-1.5 w-1.5 rounded-full bg-primary/30"
        style={{
          transform: "translate(-50%, -50%)",
          animation: "doma-empty-drift 6s ease-in-out infinite 1s",
        }}
      />
    </div>
  );
}

function DriftStyles() {
  return (
    <style jsx>{`
      @keyframes doma-empty-drift {
        0%,
        100% {
          opacity: 0.6;
        }
        50% {
          transform: translate(-50%, -50%) translateY(-12px);
          opacity: 1;
        }
      }
    `}</style>
  );
}

export function EmptyState({
  view,
  onUploadClick,
  trashRetentionDays = 30,
  canUpload = false,
}: Props) {
  if (view === "trash") {
    const retentionText =
      trashRetentionDays > 0
        ? `Удалённые файлы появятся здесь. Через ${trashRetentionDays} ${plural(trashRetentionDays, "день", "дня", "дней")} они будут стёрты навсегда.`
        : "Удалённые файлы появятся здесь. Автоочистка отключена — файлы будут храниться, пока вы не удалите их вручную.";

    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-4">
        <div className="h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
          <Trash2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Корзина пуста</h3>
        <p className="text-sm text-muted-foreground max-w-xs">{retentionText}</p>
      </div>
    );
  }

  if (view === "shared-root") {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-4">
        <DriftMotifs />
        <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5 ring-4 ring-primary/5 doma-warm-glow">
          <Users className="h-10 w-10 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Пока нет общих файлов</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Когда кто-то откроет вам файл или папку, они появятся здесь.
        </p>
        <DriftStyles />
      </div>
    );
  }

  if (view === "shared-folder") {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-4">
        <DriftMotifs />
        <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5 ring-4 ring-primary/5 doma-warm-glow">
          {canUpload ? (
            <UploadCloud className="h-10 w-10 text-primary" />
          ) : (
            <FolderOpen className="h-10 w-10 text-primary" />
          )}
        </div>
        <h3 className="text-xl font-semibold mb-2">В этой папке пока пусто</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          {canUpload
            ? "Перетащите файлы сюда или нажмите кнопку, чтобы загрузить первые фото, видео или документы."
            : "У вас нет прав на загрузку в эту папку — только просмотр."}
        </p>
        {canUpload && onUploadClick && (
          <Button onClick={onUploadClick} size="lg" className="gap-2 shadow-sm doma-warm-glow">
            <UploadCloud className="h-4 w-4" />
            Загрузить файлы
          </Button>
        )}
        <DriftStyles />
      </div>
    );
  }

  // files
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-4">
      <DriftMotifs />
      <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-5 ring-4 ring-primary/5 doma-warm-glow">
        <UploadCloud className="h-10 w-10 text-primary" />
      </div>
      <h3 className="text-xl font-semibold mb-2">Здесь пока пусто</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Перетащите файлы сюда или нажмите кнопку, чтобы загрузить первые фото,
        видео или документы.
      </p>
      {onUploadClick && (
        <Button onClick={onUploadClick} size="lg" className="gap-2 shadow-sm doma-warm-glow">
          <UploadCloud className="h-4 w-4" />
          Загрузить файлы
        </Button>
      )}
      <DriftStyles />
    </div>
  );
}
