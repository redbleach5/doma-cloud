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

  // Multi-select
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  selectMany: (ids: string[]) => void;

  // Upload progress overlay
  uploadVisible: boolean;
  setUploadVisible: (v: boolean) => void;
}

export const useCloudStore = create<CloudState>((set) => ({
  path: [{ id: null, name: "Дом" }],
  pushFolder: (id, name) =>
    set((s) => ({ path: [...s.path, { id, name }] })),
  popTo: (index) =>
    set((s) => ({ path: s.path.slice(0, index + 1), selected: new Set() })),
  reset: () => set({ path: [{ id: null, name: "Дом" }], selected: new Set() }),

  view: "files",
  setView: (v) =>
    set({
      view: v,
      selected: new Set(),
      // Only reset path when switching to files/trash views.
      path:
        v === "files"
          ? [{ id: null, name: "Дом" }]
          : v === "trash"
            ? [{ id: null, name: "Корзина" }]
            : [{ id: null, name: v === "settings" ? "Настройки" : "Админ-панель" }],
    }),

  layout: "grid",
  setLayout: (l) => set({ layout: l }),

  selected: new Set(),
  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),
  clearSelected: () => set({ selected: new Set() }),
  selectMany: (ids) => set({ selected: new Set(ids) }),

  uploadVisible: false,
  setUploadVisible: (v) => set({ uploadVisible: v }),
}));
