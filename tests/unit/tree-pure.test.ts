import { describe, expect, it } from "bun:test";
import { sanitizeName } from "@/lib/cloud/tree";

describe("sanitizeName", () => {
  it("passes through clean filenames", () => {
    expect(sanitizeName("hello.txt")).toBe("hello.txt");
    expect(sanitizeName("photo.jpg")).toBe("photo.jpg");
    expect(sanitizeName("document.pdf")).toBe("document.pdf");
  });

  it("preserves spaces", () => {
    expect(sanitizeName("hello world.txt")).toBe("hello world.txt");
  });

  it("preserves Cyrillic / Unicode characters", () => {
    expect(sanitizeName("привет.txt")).toBe("привет.txt");
    expect(sanitizeName("照片.jpg")).toBe("照片.jpg");
  });

  it("replaces Windows forbidden characters with underscore", () => {
    // Forbidden on Windows: \ / : * ? " < > |
    expect(sanitizeName("a\\b")).toBe("a_b");
    expect(sanitizeName("a/b")).toBe("a_b");
    expect(sanitizeName("a:b")).toBe("a_b");
    expect(sanitizeName("a*b")).toBe("a_b");
    expect(sanitizeName("a?b")).toBe("a_b");
    expect(sanitizeName('a"b')).toBe("a_b");
    expect(sanitizeName("a<b")).toBe("a_b");
    expect(sanitizeName("a>b")).toBe("a_b");
    expect(sanitizeName("a|b")).toBe("a_b");
  });

  it("replaces control characters (0x00-0x1F) with underscore", () => {
    expect(sanitizeName("a\u0000b")).toBe("a_b");
    expect(sanitizeName("a\u0001b")).toBe("a_b");
    expect(sanitizeName("a\u001Fb")).toBe("a_b");
    // 0x20 (space) is NOT a control char.
    expect(sanitizeName("a b")).toBe("a b");
  });

  it("strips leading dots (prevents hidden files on Unix)", () => {
    expect(sanitizeName(".htaccess")).toBe("htaccess");
    expect(sanitizeName("..hidden")).toBe("hidden");
    expect(sanitizeName("...triple")).toBe("triple");
    // Reserved on-disk meta dir must not become a user-visible folder name.
    expect(sanitizeName(".doma")).toBe("untitled");
    // Dots in the middle or end are preserved.
    expect(sanitizeName("file.txt")).toBe("file.txt");
    expect(sanitizeName("file.")).toBe("file.");
  });

  it("trims surrounding whitespace (spaces only — tabs are control chars and get replaced)", () => {
    // Spaces (0x20) are NOT in the forbidden-char regex, so they survive
    // until the .trim() step.
    expect(sanitizeName("  hello  ")).toBe("hello");
    // Tabs (0x09) ARE control chars (\u0000-\u001f) → replaced with '_'.
    // After replacement there's no whitespace left to trim.
    expect(sanitizeName("\thello\t")).toBe("_hello_");
  });

  it("truncates to 240 characters", () => {
    const long = "a".repeat(500);
    const result = sanitizeName(long);
    expect(result.length).toBe(240);
  });

  it("returns 'untitled' for empty / all-stripped input", () => {
    expect(sanitizeName("")).toBe("untitled");
    expect(sanitizeName("   ")).toBe("untitled");
    expect(sanitizeName("...")).toBe("untitled");
    expect(sanitizeName("\\")).toBe("untitled");
  });

  it("combines multiple sanitization rules", () => {
    // Order: replace forbidden chars → trim → strip leading dots → truncate.
    expect(sanitizeName("  ..a/b:c?  ")).toBe("a_b_c_");
    expect(sanitizeName("..a/b:c?")).toBe("a_b_c_");
  });
});
