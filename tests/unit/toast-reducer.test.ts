import { describe, expect, it, beforeEach } from "bun:test";
// The toast module keeps internal module state (memoryState, listeners, count).
// We import the reducer directly to test it as a pure function, plus the
// public toast/dispatch API for side-effectful tests.
import { reducer } from "@/hooks/use-toast";
import type { ToastProps } from "@/components/ui/toast";

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action?: any;
};

function makeToast(id: string, over: Partial<ToasterToast> = {}): ToasterToast {
  return {
    id,
    open: true,
    ...over,
  } as ToasterToast;
}

describe("toast reducer (pure function)", () => {
  const initialState = { toasts: [] };

  describe("ADD_TOAST", () => {
    it("adds a toast to an empty state", () => {
      const toast = makeToast("1", { title: "Hello" });
      const next = reducer(initialState, { type: "ADD_TOAST", toast });
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0].id).toBe("1");
      expect(next.toasts[0].title).toBe("Hello");
    });

    it("prepends new toasts (most recent first), though TOAST_LIMIT=1 drops older ones", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "ADD_TOAST", toast: makeToast("2") });
      // With TOAST_LIMIT=1, only the new toast survives.
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0].id).toBe("2");
    });

    it("enforces the TOAST_LIMIT of 1 (drops older toasts)", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "ADD_TOAST", toast: makeToast("2") });
      // Only the most recent toast survives.
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0].id).toBe("2");
    });

    it("does NOT mutate the original state", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "ADD_TOAST", toast: makeToast("2") });
      expect(state.toasts).toHaveLength(1); // unchanged
      expect(next.toasts).toHaveLength(1); // new state has the new toast
    });
  });

  describe("UPDATE_TOAST", () => {
    it("updates a specific toast by id", () => {
      const state = { toasts: [makeToast("1", { title: "Old" })] };
      const next = reducer(state, {
        type: "UPDATE_TOAST",
        toast: { id: "1", title: "New" },
      });
      expect(next.toasts[0].title).toBe("New");
    });

    it("leaves other toasts untouched", () => {
      const state = {
        toasts: [
          makeToast("1", { title: "A" }),
          // Note: TOAST_LIMIT=1 means only one toast survives ADD, so we
          // test with a single-toast state.
        ],
      };
      const next = reducer(state, {
        type: "UPDATE_TOAST",
        toast: { id: "nonexistent", title: "X" },
      });
      expect(next.toasts[0].title).toBe("A"); // unchanged
    });

    it("is a no-op when the toast id doesn't match", () => {
      const state = { toasts: [makeToast("1", { title: "A" })] };
      const next = reducer(state, {
        type: "UPDATE_TOAST",
        toast: { id: "999", title: "X" },
      });
      expect(next.toasts).toHaveLength(1);
      expect(next.toasts[0].title).toBe("A");
    });

    it("merges partial updates (preserves untouched fields)", () => {
      const state = { toasts: [makeToast("1", { title: "A", description: "B" })] };
      const next = reducer(state, {
        type: "UPDATE_TOAST",
        toast: { id: "1", title: "New title" },
      });
      expect(next.toasts[0].title).toBe("New title");
      expect(next.toasts[0].description).toBe("B"); // preserved
    });
  });

  describe("DISMISS_TOAST", () => {
    it("sets open=false on the specified toast", () => {
      const state = { toasts: [makeToast("1", { open: true })] };
      const next = reducer(state, { type: "DISMISS_TOAST", toastId: "1" });
      expect(next.toasts[0].open).toBe(false);
    });

    it("dismisses ALL toasts when no toastId is provided", () => {
      // TOAST_LIMIT=1 means we only ever have one toast, so this is mostly
      // a guard against the forEach(undefined) case.
      const state = { toasts: [makeToast("1", { open: true })] };
      const next = reducer(state, { type: "DISMISS_TOAST" });
      expect(next.toasts[0].open).toBe(false);
    });

    it("does NOT remove the toast (only marks it closed)", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "DISMISS_TOAST", toastId: "1" });
      expect(next.toasts).toHaveLength(1); // still there
      expect(next.toasts[0].open).toBe(false);
    });
  });

  describe("REMOVE_TOAST", () => {
    it("removes the specified toast from the list", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "REMOVE_TOAST", toastId: "1" });
      expect(next.toasts).toHaveLength(0);
    });

    it("removes ALL toasts when no toastId is provided", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "REMOVE_TOAST" });
      expect(next.toasts).toHaveLength(0);
    });

    it("is a no-op when the toast id doesn't exist", () => {
      const state = { toasts: [makeToast("1")] };
      const next = reducer(state, { type: "REMOVE_TOAST", toastId: "999" });
      expect(next.toasts).toHaveLength(1);
    });
  });
});
