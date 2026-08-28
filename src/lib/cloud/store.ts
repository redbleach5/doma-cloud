"use client";

import { create } from "zustand";
import type { FileItem } from "@/lib/cloud/api";

export type View = "files" | "trash" | "shared" | "shared-by-me" | "settings" | "admin";
export type Layout = "grid" | "list";

/**
 * Path-segment descriptor. For "shared" view, the first segment's id is the
 * shared-folder root id (not null) and carries an extra `sharedFolderId`
 * for routing API calls back to the share-aware endpoints.
 */
export interface PathSegment {
  id: string | null;
  name: string;
  /** Set on the FIRST segment of a shared-folder navigation. Carries the
   *  SharedFolder.id so the API knows which share the viewer is browsing. */
  sharedFolderId?: string;
  /** Permission the viewer has on this shared folder. undefined for owned. */
  permission?: "view" | "upload" | "edit";
}

interface CloudState {
  // Current folder path as array of {id, name} segments. Empty = root.
  path: Array<PathSegment>;
  pushFolder: (id: string, name: string) => void;
  pushSharedFolder: (rootFolderId: string, name: string, sharedFolderId: string, permission: "view" | "upload" | "edit") => void;
  popTo: (index: number) => void;
  reset: () => void;

  view: View;
  setView: (v: View) => void;

  layout: Layout;
  setLayout: (l: Layout) => void;

  // Upload progress overlay
  uploadVisible: boolean;
  setUploadVisible: (v: boolean) => void;

  /** Request FileBrowser to open a preview (e.g. «Случайное из дома»). */
  pendingPreview: FileItem | null;
  setPendingPreview: (item: FileItem | null) => void;
}

export const useCloudStore = create<CloudState>((set) => ({
  path: [{ id: null, name: "Дом" }],
  pushFolder: (id, name) =>
    set((s) => ({ path: [...s.path, { id, name }] })),
  pushSharedFolder: (rootFolderId, name, sharedFolderId, permission) =>
    set((s) => ({ path: [{ id: rootFolderId, name, sharedFolderId, permission }] })),
  popTo: (index) =>
    set((s) => ({ path: s.path.slice(0, index + 1) })),
  reset: () =>
    set({
      path: [{ id: null, name: "Дом" }],
      view: "files",
      pendingPreview: null,
    }),

  view: "files",
  setView: (v) => {
    // Compute the new path based on the target view, then set both atomically.
    const newPath =
      v === "files"
        ? [{ id: null, name: "Дом" }]
        : v === "trash"
          ? [{ id: null, name: "Корзина" }]
          : v === "shared"
            ? [{ id: null, name: "Поделились со мной" }]
            : v === "shared-by-me"
              ? [{ id: null, name: "Мои общие" }]
              : v === "settings"
                ? [{ id: null, name: "Настройки" }]
                : [{ id: null, name: "Админ-панель" }];
    set({ view: v, path: newPath });
  },

  layout: "grid",
  setLayout: (l) => set({ layout: l }),

  uploadVisible: false,
  setUploadVisible: (v) => set({ uploadVisible: v }),

  pendingPreview: null,
  setPendingPreview: (item) => set({ pendingPreview: item }),
}));
