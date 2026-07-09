import { describe, expect, it, beforeEach, afterEach, afterAll } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { setupDom, resetDom, teardownDom } from "../../helpers/react";
import { EmptyState } from "@/components/cloud/empty-state";

describe("EmptyState component", () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    resetDom();
  });

  afterAll(() => {
    teardownDom();
  });

  describe("files view", () => {
    it("renders the empty-files message", () => {
      render(<EmptyState view="files" onUploadClick={() => undefined} />);
      expect(screen.getByText("Здесь пока пусто")).toBeTruthy();
    });

    it("renders the upload hint text", () => {
      render(<EmptyState view="files" onUploadClick={() => undefined} />);
      const hint = screen.getByText(/Перетащите файлы сюда/i);
      expect(hint).toBeTruthy();
    });

    it("renders the 'Загрузить файлы' button", () => {
      render(<EmptyState view="files" onUploadClick={() => undefined} />);
      const button = screen.getByRole("button", { name: /загрузить файлы/i });
      expect(button).toBeTruthy();
    });

    it("calls onUploadClick when the upload button is clicked", () => {
      let clicked = false;
      render(<EmptyState view="files" onUploadClick={() => { clicked = true; }} />);
      const button = screen.getByRole("button", { name: /загрузить файлы/i });
      fireEvent.click(button);
      expect(clicked).toBe(true);
    });
  });

  describe("trash view", () => {
    it("renders the 'Корзина пуста' message", () => {
      render(<EmptyState view="trash" onUploadClick={() => undefined} />);
      expect(screen.getByText("Корзина пуста")).toBeTruthy();
    });

    it("renders the 30-day auto-purge hint", () => {
      render(<EmptyState view="trash" onUploadClick={() => undefined} />);
      expect(screen.getByText(/30 дней/i)).toBeTruthy();
    });

    it("does NOT render the upload button in trash view", () => {
      render(<EmptyState view="trash" onUploadClick={() => undefined} />);
      expect(screen.queryByRole("button", { name: /загрузить/i })).toBeNull();
    });

    it("does NOT call onUploadClick in trash view (no button to click)", () => {
      let clicked = false;
      render(<EmptyState view="trash" onUploadClick={() => { clicked = true; }} />);
      // No button exists in trash view, so onUploadClick can't be triggered.
      expect(clicked).toBe(false);
    });
  });
});
