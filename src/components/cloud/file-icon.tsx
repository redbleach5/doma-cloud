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
  if (item.isDirectory) return <Folder className={cn("text-amber-500", className)} fill="currentColor" fillOpacity={0.15} />;

  const icon = iconFor(item);
  return icon;
}

function iconFor(item: FileItem) {
  const className = "text-muted-foreground";
  switch (item.category) {
    case "image":
      return <FileImage className={cn("text-emerald-500", className)} />;
    case "video":
      return <FileVideo className={cn("text-rose-500", className)} />;
    case "audio":
      return <FileAudio className={cn("text-purple-500", className)} />;
    case "pdf":
      return <FileType className={cn("text-red-500", className)} />;
    case "code":
      return <FileCode className={cn("text-sky-500", className)} />;
    case "markdown":
      return <FileText className={cn("text-orange-500", className)} />;
    case "office":
      return <FileSpreadsheet className={cn("text-amber-600", className)} />;
    case "archive":
      return <FileArchive className={cn("text-yellow-700", className)} />;
    case "text":
      return <FileText className={cn("text-blue-500", className)} />;
    default:
      return <FileIconGeneric className={className} />;
  }
}
