import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { resetDom } from "../../helpers/react";
import { Breadcrumbs } from "@/components/cloud/breadcrumbs";
import { useCloudStore } from "@/lib/cloud/store";

describe("Breadcrumbs component", () => {
  beforeEach(() => {
    // Reset the store to a known state before each test.
    useCloudStore.setState({
      path: [{ id: null, name: "Дом" }],
      view: "files",
      layout: "grid",
      uploadVisible: false,
    });
  });

  afterEach(() => {
    resetDom();
  });

  describe("trash view", () => {
    it("renders 'Корзина' and nothing else", () => {
      useCloudStore.getState().setView("trash");
      render(<Breadcrumbs />);
      expect(screen.getByText("Корзина")).toBeTruthy();
      // No breadcrumb buttons (it's a <span>, not a <button>).
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("does NOT render the Home icon in trash view", () => {
      useCloudStore.getState().setView("trash");
      const { container } = render(<Breadcrumbs />);
      // Home icon has class "lucide-home" or "lucide-house" (version-dependent).
      expect(container.querySelector(".lucide-home, .lucide-house")).toBeNull();
    });
  });

  describe("files view at root", () => {
    it("renders a single 'Дом' breadcrumb at root", () => {
      render(<Breadcrumbs />);
      expect(screen.getByText("Дом")).toBeTruthy();
    });

    it("renders the Home icon for the root segment", () => {
      const { container } = render(<Breadcrumbs />);
      // lucide-react renamed Home to House in recent versions; the icon
      // renders as either lucide-home or lucide-house depending on version.
      const homeIcon = container.querySelector(".lucide-home, .lucide-house");
      expect(homeIcon).not.toBeNull();
    });

    it("renders the root as a button", () => {
      render(<Breadcrumbs />);
      // The root segment is the last (and only) segment, so it's a button
      // but with no onClick (isLast === true).
      expect(screen.getByText("Дом").closest("button")).not.toBeNull();
    });
  });

  describe("nested path", () => {
    it("renders one breadcrumb per path segment", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      useCloudStore.getState().pushFolder("f2", "2024");
      render(<Breadcrumbs />);
      expect(screen.getByText("Дом")).toBeTruthy();
      expect(screen.getByText("Photos")).toBeTruthy();
      expect(screen.getByText("2024")).toBeTruthy();
    });

    it("renders ChevronRight separators between segments (not before the first)", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      const { container } = render(<Breadcrumbs />);
      // 2 segments → 1 chevron separator.
      const chevrons = container.querySelectorAll(".lucide-chevron-right");
      expect(chevrons).toHaveLength(1);
    });

    it("renders N-1 chevrons for N segments", () => {
      useCloudStore.getState().pushFolder("f1", "A");
      useCloudStore.getState().pushFolder("f2", "B");
      useCloudStore.getState().pushFolder("f3", "C");
      const { container } = render(<Breadcrumbs />);
      // 4 segments → 3 chevrons.
      expect(container.querySelectorAll(".lucide-chevron-right")).toHaveLength(3);
    });

    it("marks the last segment as bold (font-medium)", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      render(<Breadcrumbs />);
      const lastBtn = screen.getByText("Photos").closest("button");
      expect(lastBtn?.className).toContain("font-medium");
    });

    it("clicking a non-last segment calls popTo (navigates back)", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      useCloudStore.getState().pushFolder("f2", "2024");
      render(<Breadcrumbs />);
      // Click "Photos" (the middle segment, not the last).
      fireEvent.click(screen.getByText("Photos"));
      // The store should have truncated the path to [Дом, Photos].
      expect(useCloudStore.getState().path).toHaveLength(2);
      expect(useCloudStore.getState().path[1].name).toBe("Photos");
    });

    it("clicking the LAST segment does NOT navigate (no-op)", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      render(<Breadcrumbs />);
      // Click "Photos" — the last segment. Should NOT pop.
      fireEvent.click(screen.getByText("Photos"));
      expect(useCloudStore.getState().path).toHaveLength(2); // unchanged
    });

    it("clicking the root segment when at a nested path navigates to root", () => {
      useCloudStore.getState().pushFolder("f1", "Photos");
      useCloudStore.getState().pushFolder("f2", "2024");
      render(<Breadcrumbs />);
      fireEvent.click(screen.getByText("Дом"));
      expect(useCloudStore.getState().path).toHaveLength(1);
      expect(useCloudStore.getState().path[0].name).toBe("Дом");
    });
  });

  describe("navigation aria-label", () => {
    it("has an aria-label of 'Путь' on the nav element", () => {
      const { container } = render(<Breadcrumbs />);
      const nav = container.querySelector("nav");
      expect(nav?.getAttribute("aria-label")).toBe("Путь");
    });
  });
});
