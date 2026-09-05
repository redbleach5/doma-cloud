"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";

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

  // Block the browser's default behavior of opening a dropped file when
  // the drop lands outside the dropzone (e.g. on the header or sidebar).
  const onWindowDragOver = React.useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);
  const onWindowDrop = React.useCallback((e: DragEvent) => {
    e.preventDefault();
    // The drop landed somewhere on the page — reset our drag state so the
    // overlay doesn't stay on screen.
    dragCounter.current = 0;
    setIsDragging(false);
  }, []);

  // Reset drag state when the user drops the file OUTSIDE the browser
  // window, cancels the drag (Esc → dragend), or the window loses focus
  // mid-drag. Without this the "drop here" overlay can persist
  // indefinitely after a drop outside the dropzone.
  const onWindowDragEnd = React.useCallback(() => {
    dragCounter.current = 0;
    setIsDragging(false);
  }, []);
  const onWindowBlur = React.useCallback(() => {
    dragCounter.current = 0;
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("dragend", onWindowDragEnd);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      window.removeEventListener("dragend", onWindowDragEnd);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [onWindowDragOver, onWindowDrop, onWindowDragEnd, onWindowBlur]);

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
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-background/95 p-8 text-center shadow-xl doma-settle">
            <UploadCloud className="h-10 w-10 text-primary mx-auto mb-2" style={{ animation: "doma-gentle-float 2.5s ease-in-out infinite" }} />
            <p className="text-lg font-medium">Отпустите, чтобы загрузить</p>
            <p className="text-sm text-muted-foreground mt-1">Файлы попадут в текущую папку</p>
          </div>
          <style jsx>{`
            @keyframes doma-gentle-float {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
