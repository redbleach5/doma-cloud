"use client";

/** Skeletons в разметке FileGrid / FileList. */

export function FileGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col p-3 rounded-xl border border-border/40 bg-card"
        >
          <div className="aspect-square w-full mb-2 rounded-lg doma-skeleton" />
          <div className="h-3 w-3/4 rounded doma-skeleton mb-1.5" />
          <div className="h-2.5 w-1/2 rounded doma-skeleton" />
        </div>
      ))}
    </div>
  );
}

export function FileListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden bg-card">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 border-b border-border/40 bg-muted/30">
        <div className="h-3 w-12 rounded doma-skeleton" />
        <div className="hidden sm:block h-3 w-16 rounded doma-skeleton ml-auto" />
        <div className="h-3 w-10 rounded doma-skeleton ml-auto" />
      </div>
      <div className="divide-y divide-border/30">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-2 items-center px-4 py-2.5 min-h-11"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg doma-skeleton shrink-0" />
              <div className="h-3.5 w-40 max-w-[55%] rounded doma-skeleton" />
            </div>
            <div className="hidden sm:block h-3 w-16 rounded doma-skeleton ml-auto" />
            <div className="h-3 w-10 rounded doma-skeleton ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
