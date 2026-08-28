import { describe, expect, it } from "bun:test";
import { buildStorageKey, assertStorageKeyOwner } from "@/lib/storage";

describe("buildStorageKey", () => {
  it("formats as users/<ownerId>/files/<fileId>/<safeName>", () => {
    expect(buildStorageKey("user1", "file1", "photo.jpg")).toBe(
      "users/user1/files/file1/photo.jpg"
    );
  });

  it("replaces path separators in the name with underscore", () => {
    expect(buildStorageKey("u", "f", "a/b\\c")).toBe("users/u/files/f/a_b_c");
  });

  it("replaces other forbidden characters in the name", () => {
    expect(buildStorageKey("u", "f", 'a:b*c?d"e<f>g|h')).toBe(
      "users/u/files/f/a_b_c_d_e_f_g_h"
    );
  });

  it("truncates the safe name to 180 characters", () => {
    const long = "a".repeat(500);
    const key = buildStorageKey("u", "f", long);
    const expected = "users/u/files/f/" + "a".repeat(180);
    expect(key).toBe(expected);
  });

  it("preserves spaces and unicode in the name", () => {
    expect(buildStorageKey("u", "f", "hello world.txt")).toBe("users/u/files/f/hello world.txt");
    expect(buildStorageKey("u", "f", "привет.txt")).toBe("users/u/files/f/привет.txt");
  });

  it("handles empty name (still works, produces trailing slash)", () => {
    expect(buildStorageKey("u", "f", "")).toBe("users/u/files/f/");
  });

  it("handles special characters in ownerId and fileId (they are NOT sanitized)", () => {
    // Only the name is sanitized; ownerId and fileId are assumed to be
    // system-generated (cuid/uuid) and safe.
    expect(buildStorageKey("user-123", "file-456", "name.txt")).toBe(
      "users/user-123/files/file-456/name.txt"
    );
  });
});

describe("assertStorageKeyOwner", () => {
  it("accepts v2 keys belonging to the owner", () => {
    expect(() =>
      assertStorageKeyOwner("users/user1/files/file1/photo.jpg", "user1")
    ).not.toThrow();
  });

  it("accepts legacy keys belonging to the owner", () => {
    expect(() => assertStorageKeyOwner("user1/file1/photo.jpg", "user1")).not.toThrow();
  });

  it("rejects keys under another user's namespace (v2)", () => {
    expect(() =>
      assertStorageKeyOwner("users/other/files/file1/photo.jpg", "user1")
    ).toThrow(/does not belong/i);
  });

  it("rejects legacy keys of another owner", () => {
    expect(() => assertStorageKeyOwner("other/file1/photo.jpg", "user1")).toThrow(
      /does not belong/i
    );
  });
});
