import { describe, expect, it } from "bun:test";
import { buildStorageKey } from "@/lib/storage";

describe("buildStorageKey", () => {
  it("formats as ownerId/fileId/safeName", () => {
    expect(buildStorageKey("user1", "file1", "photo.jpg")).toBe("user1/file1/photo.jpg");
  });

  it("replaces path separators in the name with underscore", () => {
    expect(buildStorageKey("u", "f", "a/b\\c")).toBe("u/f/a_b_c");
  });

  it("replaces other forbidden characters in the name", () => {
    expect(buildStorageKey("u", "f", 'a:b*c?d"e<f>g|h')).toBe("u/f/a_b_c_d_e_f_g_h");
  });

  it("truncates the safe name to 180 characters", () => {
    const long = "a".repeat(500);
    const key = buildStorageKey("u", "f", long);
    // ownerId + '/' + fileId + '/' + 180 chars
    const expected = "u/f/" + "a".repeat(180);
    expect(key).toBe(expected);
  });

  it("preserves spaces and unicode in the name", () => {
    expect(buildStorageKey("u", "f", "hello world.txt")).toBe("u/f/hello world.txt");
    expect(buildStorageKey("u", "f", "привет.txt")).toBe("u/f/привет.txt");
  });

  it("handles empty name (still works, produces trailing slash)", () => {
    expect(buildStorageKey("u", "f", "")).toBe("u/f/");
  });

  it("handles special characters in ownerId and fileId (they are NOT sanitized)", () => {
    // Only the name is sanitized; ownerId and fileId are assumed to be
    // system-generated (cuid/uuid) and safe.
    expect(buildStorageKey("user-123", "file-456", "name.txt")).toBe("user-123/file-456/name.txt");
  });
});
