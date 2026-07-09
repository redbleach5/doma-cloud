import { describe, expect, it, beforeEach } from "bun:test";
import { useCloudStore } from "@/lib/cloud/store";

describe("useCloudStore (Zustand store)", () => {
  beforeEach(() => {
    // Reset the store to its initial state before each test.
    useCloudStore.setState({
      path: [{ id: null, name: "Дом" }],
      view: "files",
      layout: "grid",
      uploadVisible: false,
    });
  });

  describe("initial state", () => {
    it("starts at root path 'Дом'", () => {
      const state = useCloudStore.getState();
      expect(state.path).toEqual([{ id: null, name: "Дом" }]);
    });

    it("starts in 'files' view", () => {
      expect(useCloudStore.getState().view).toBe("files");
    });

    it("starts with 'grid' layout", () => {
      expect(useCloudStore.getState().layout).toBe("grid");
    });

    it("starts with upload overlay hidden", () => {
      expect(useCloudStore.getState().uploadVisible).toBe(false);
    });
  });

  describe("pushFolder", () => {
    it("appends a new folder segment to the path", () => {
      useCloudStore.getState().pushFolder("folder-1", "Photos");
      const state = useCloudStore.getState();
      expect(state.path).toHaveLength(2);
      expect(state.path[1]).toEqual({ id: "folder-1", name: "Photos" });
    });

    it("preserves existing path segments", () => {
      useCloudStore.getState().pushFolder("folder-1", "Photos");
      useCloudStore.getState().pushFolder("folder-2", "2024");
      const state = useCloudStore.getState();
      expect(state.path).toHaveLength(3);
      expect(state.path[0].name).toBe("Дом");
      expect(state.path[1].name).toBe("Photos");
      expect(state.path[2].name).toBe("2024");
    });

    it("does NOT mutate the previous path array (immutability)", () => {
      const before = useCloudStore.getState().path;
      useCloudStore.getState().pushFolder("f1", "Sub");
      expect(before).toHaveLength(1); // original unchanged
      expect(useCloudStore.getState().path).toHaveLength(2);
    });
  });

  describe("popTo", () => {
    it("truncates the path to the given index (inclusive)", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().pushFolder("f2", "B");
      useCloudStore.getState().pushFolder("f3", "C");
      // path = [Дом, A, B, C]
      useCloudStore.getState().popTo(1); // keep [Дом, A]
      const state = useCloudStore.getState();
      expect(state.path).toHaveLength(2);
      expect(state.path[1].name).toBe("A");
    });

    it("popTo(0) resets to just root", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().pushFolder("f2", "B");
      useCloudStore.getState().popTo(0);
      expect(useCloudStore.getState().path).toEqual([{ id: null, name: "Дом" }]);
    });

    it("popTo beyond the last index keeps the whole path", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().popTo(5); // beyond end
      expect(useCloudStore.getState().path).toHaveLength(2);
    });
  });

  describe("reset", () => {
    it("resets the path to just root", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().pushFolder("f2", "B");
      useCloudStore.getState().reset();
      expect(useCloudStore.getState().path).toEqual([{ id: null, name: "Дом" }]);
    });

    it("does NOT change view or layout", () => {
      useCloudStore.setState({ view: "trash", layout: "list" });
      useCloudStore.getState().reset();
      expect(useCloudStore.getState().view).toBe("trash");
      expect(useCloudStore.getState().layout).toBe("list");
    });
  });

  describe("setView", () => {
    it("switches to the 'trash' view with a 'Корзина' root path", () => {
      useCloudStore.getState().setView("trash");
      const state = useCloudStore.getState();
      expect(state.view).toBe("trash");
      expect(state.path).toEqual([{ id: null, name: "Корзина" }]);
    });

    it("switches to the 'files' view with a 'Дом' root path", () => {
      useCloudStore.getState().setView("trash");
      useCloudStore.getState().setView("files");
      const state = useCloudStore.getState();
      expect(state.view).toBe("files");
      expect(state.path).toEqual([{ id: null, name: "Дом" }]);
    });

    it("switches to the 'settings' view with a 'Настройки' root path", () => {
      useCloudStore.getState().setView("settings");
      const state = useCloudStore.getState();
      expect(state.view).toBe("settings");
      expect(state.path).toEqual([{ id: null, name: "Настройки" }]);
    });

    it("switches to the 'admin' view with an 'Админ-панель' root path", () => {
      useCloudStore.getState().setView("admin");
      const state = useCloudStore.getState();
      expect(state.view).toBe("admin");
      expect(state.path).toEqual([{ id: null, name: "Админ-панель" }]);
    });

    it("resets any existing folder navigation when switching views", () => {
      useCloudStore.getState().pushFolder("f1", "Subfolder");
      expect(useCloudStore.getState().path).toHaveLength(2);
      useCloudStore.getState().setView("files");
      // After switching views the path should be reset to root.
      expect(useCloudStore.getState().path).toHaveLength(1);
    });
  });

  describe("setLayout", () => {
    it("switches layout to 'list'", () => {
      useCloudStore.getState().setLayout("list");
      expect(useCloudStore.getState().layout).toBe("list");
    });

    it("switches layout back to 'grid'", () => {
      useCloudStore.getState().setLayout("list");
      useCloudStore.getState().setLayout("grid");
      expect(useCloudStore.getState().layout).toBe("grid");
    });

    it("does NOT affect path or view", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().setLayout("list");
      expect(useCloudStore.getState().path).toHaveLength(2);
      expect(useCloudStore.getState().view).toBe("files");
    });
  });

  describe("setUploadVisible", () => {
    it("shows the upload overlay", () => {
      useCloudStore.getState().setUploadVisible(true);
      expect(useCloudStore.getState().uploadVisible).toBe(true);
    });

    it("hides the upload overlay", () => {
      useCloudStore.getState().setUploadVisible(true);
      useCloudStore.getState().setUploadVisible(false);
      expect(useCloudStore.getState().uploadVisible).toBe(false);
    });
  });

  describe("subscribe (reactivity)", () => {
    it("notifies subscribers on state change", () => {
      const calls: string[] = [];
      const unsub = useCloudStore.subscribe((state) => {
        calls.push(state.view);
      });
      useCloudStore.getState().setView("trash");
      useCloudStore.getState().setView("admin");
      expect(calls).toEqual(["trash", "admin"]);
      unsub();
    });
  });
});
