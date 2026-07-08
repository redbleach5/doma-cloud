"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onFilesDropped: (files: File[], x: number, y: number) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function UploadDropzone({ onFilesDropped, disabled, children }: Props) {
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounter = React.useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Pass the drop coordinates so the burst can originate from the cursor.
      onFilesDropped(files, e.clientX, e.clientY);
    }
  };

  return (
    <div
      className="relative flex-1 flex flex-col overflow-hidden"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-background/95 p-8 text-center shadow-xl">
            <UploadCloud className="h-10 w-10 text-primary mx-auto mb-2 animate-bounce" />
            <p className="text-lg font-medium">Отпустите, чтобы загрузить</p>
            <p className="text-sm text-muted-foreground mt-1">Файлы попадут в текущую папку</p>
          </div>
        </div>
      )}
    </div>
  );
}
