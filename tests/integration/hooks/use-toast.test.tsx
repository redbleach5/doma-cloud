import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { resetDom } from "../../helpers/react";
import { useToast } from "@/hooks/use-toast";

describe("useToast hook", () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it("starts with an empty toasts array", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toHaveLength(0);
  });

  it("adds a toast via the toast() function", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Hello" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Hello");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("generates a unique id for each toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "A" });
    });
    const id1 = result.current.toasts[0].id;
    act(() => {
      result.current.toast({ title: "B" });
    });
    // TOAST_LIMIT=1, so only the second toast survives — but its id should
    // differ from the first.
    expect(result.current.toasts[0].id).not.toBe(id1);
  });

  it("enforces TOAST_LIMIT=1 (second toast replaces the first)", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "First" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("First");

    act(() => {
      result.current.toast({ title: "Second" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss() marks the toast as closed (open=false)", () => {
    const { result } = renderHook(() => useToast());
    let toastId: string;
    act(() => {
      const t = result.current.toast({ title: "Dismiss me" });
      toastId = t.id;
    });
    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      result.current.dismiss(toastId!);
    });
    expect(result.current.toasts[0].open).toBe(false);
    // The toast is still in the list (just closed), not removed.
    expect(result.current.toasts).toHaveLength(1);
  });

  it("dismiss() with no id dismisses ALL toasts", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "A" });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("toast() returns an object with id, dismiss, and update functions", () => {
    const { result } = renderHook(() => useToast());
    let toastResult: { id: string; dismiss: () => void; update: (p: unknown) => void } | null = null;
    act(() => {
      toastResult = result.current.toast({ title: "X" });
    });
    expect(toastResult).not.toBeNull();
    expect(typeof toastResult!.id).toBe("string");
    expect(typeof toastResult!.dismiss).toBe("function");
    expect(typeof toastResult!.update).toBe("function");
  });

  it("update() modifies an existing toast", () => {
    const { result } = renderHook(() => useToast());
    let toastHandle: { id: string; update: (p: { id: string; title: string }) => void } | null = null;
    act(() => {
      toastHandle = result.current.toast({ title: "Old" });
    });
    act(() => {
      toastHandle!.update({ id: toastHandle!.id, title: "New" });
    });
    expect(result.current.toasts[0].title).toBe("New");
  });

  it("the toast's onOpenChange callback dismisses when open=false", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test" });
    });
    const toast = result.current.toasts[0];
    expect(toast.onOpenChange).toBeDefined();
    // Simulate the user closing the toast.
    act(() => {
      toast.onOpenChange?.(false);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("the toast's onOpenChange callback does NOT dismiss when open=true", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Test" });
    });
    const toast = result.current.toasts[0];
    act(() => {
      toast.onOpenChange?.(true);
    });
    expect(result.current.toasts[0].open).toBe(true);
  });
});
