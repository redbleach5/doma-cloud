"use client";

import { create } from "zustand";

export type View = "files" | "trash" | "settings" | "admin";
export type Layout = "grid" | "list";

interface CloudState {
  // Current folder path as array of {id, name} segments. Empty = root.
  path: Array<{ id: string | null; name: string }>;
  pushFolder: (id: string, name: string) => void;
  popTo: (index: number) => void;
  reset: () => void;

  view: View;
  setView: (v: View) => void;

  layout: Layout;
  setLayout: (l: Layout) => void;

  // Upload progress overlay
  uploadVisible: boolean;
  setUploadVisible: (v: boolean) => void;
}

export const useCloudStore = create<CloudState>((set) => ({
  path: [{ id: null, name: "Дом" }],
  pushFolder: (id, name) =>
    set((s) => ({ path: [...s.path, { id, name }] })),
  popTo: (index) =>
    set((s) => ({ path: s.path.slice(0, index + 1) })),
  reset: () => set({ path: [{ id: null, name: "Дом" }], view: "files" }),

  view: "files",
  setView: (v) => {
    // Compute the new path based on the target view, then set both atomically.
    const newPath =
      v === "files"
        ? [{ id: null, name: "Дом" }]
        : v === "trash"
          ? [{ id: null, name: "Корзина" }]
          : v === "settings"
            ? [{ id: null, name: "Настройки" }]
            : [{ id: null, name: "Админ-панель" }];
    set({ view: v, path: newPath });
  },

  layout: "grid",
  setLayout: (l) => set({ layout: l }),

  uploadVisible: false,
  setUploadVisible: (v) => set({ uploadVisible: v }),
}));
