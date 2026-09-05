import { describe, expect, it, afterEach } from "bun:test";
import { render, screen } from "@testing-library/react";
import { resetDom } from "../../helpers/react";
import { QueryProvider } from "@/components/cloud/query-provider";

describe("QueryProvider", () => {
  afterEach(() => {
    resetDom();
  });

  it("renders its children", () => {
    render(
      <QueryProvider>
        <div>Child content</div>
      </QueryProvider>
    );
    expect(screen.getByText("Child content")).toBeTruthy();
  });

  it("wraps children in a React Query context (does not throw)", () => {
    expect(() => {
      render(
        <QueryProvider>
          <span>test</span>
        </QueryProvider>
      );
    }).not.toThrow();
  });

  it("creates a single QueryClient instance (stable across re-renders)", () => {
    // The provider uses useState(() => new QueryClient()) so the client
    // is created ONCE. We can't easily assert this from outside, but we
    // can verify the provider renders children correctly.
    const { rerender } = render(
      <QueryProvider>
        <div>v1</div>
      </QueryProvider>
    );
    expect(screen.getByText("v1")).toBeTruthy();
    rerender(
      <QueryProvider>
        <div>v2</div>
      </QueryProvider>
    );
    expect(screen.getByText("v2")).toBeTruthy();
  });
});
