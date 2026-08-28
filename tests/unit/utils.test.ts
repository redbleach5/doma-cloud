import { describe, expect, it } from "bun:test";
import { cn } from "@/lib/utils";

describe("cn (className combiner)", () => {
  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("passes through a single class", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("merges multiple classes", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz");
  });

  it("skips falsy values (undefined, null, false, empty)", () => {
    expect(cn("foo", undefined, null, false, "", "bar")).toBe("foo bar");
  });

  it("handles conditional class objects (clsx syntax)", () => {
    expect(cn({ active: true, hidden: false })).toBe("active");
  });

  it("handles arrays of classes", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("deduplicates conflicting tailwind classes (twMerge)", () => {
    // twMerge resolves tailwind conflicts: the later class wins.
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting tailwind classes", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("mixes conditional, array, and string inputs", () => {
    const result = cn("base", ["arr1", "arr2"], { cond: true, skip: false }, "end");
    expect(result).toBe("base arr1 arr2 cond end");
  });
});
