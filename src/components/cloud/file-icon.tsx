"use client";

import {
  FileText, FileImage, FileVideo, FileAudio, FileCode, FileArchive,
  FileType, Folder, FileSpreadsheet, File as FileIconGeneric,
} from "lucide-react";
import type { FileItem } from "@/lib/cloud/api";
import { cn } from "@/lib/utils";

interface Props {
  item: FileItem;
  className?: string;
}

export function FileIcon({ item, className }: Props) {
  if (item.isDirectory) {
    return (
      <Folder
        className={cn("text-primary", className)}
        fill="currentColor"
        fillOpacity={0.15}
      />
    );
  }

  return iconFor(item, className);
}

function iconFor(item: FileItem, className?: string) {
  // Палитра подобрана в oklch-координатах тёплой темы Doma:
  // каждый тип файла получает свой оттенок, но все живут в тёплом спектре
  // (охра, терракота, мята, персик, багровый) — без холодных blue/purple/sky,
  // которые выбивались из янтарно-кремовой эстетики.
  switch (item.category) {
    case "image":
      return <FileImage className={cn("text-chart-2", className)} />;
    case "video":
      return <FileVideo className={cn("text-chart-3", className)} />;
    case "audio":
      return <FileAudio className={cn("text-chart-4", className)} />;
    case "pdf":
      return <FileType className={cn("text-destructive", className)} />;
    case "code":
      return <FileCode className={cn("text-primary", className)} />;
    case "markdown":
      return <FileText className={cn("text-chart-4", className)} />;
    case "office":
      return <FileSpreadsheet className={cn("text-primary", className)} />;
    case "archive":
      return <FileArchive className={cn("text-muted-foreground", className)} />;
    case "text":
      return <FileText className={cn("text-muted-foreground", className)} />;
    default:
      return <FileIconGeneric className={cn("text-muted-foreground", className)} />;
  }
}
