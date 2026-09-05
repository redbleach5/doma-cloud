import { describe, expect, it } from "bun:test";
import {
  BRAND_NAME,
  BRAND_SHORT,
  BRAND_TAGLINE,
  BRAND_TITLE,
} from "@/lib/cloud/brand";

describe("brand", () => {
  it("uses a neutral product name", () => {
    expect(BRAND_NAME).toBe("Doma Cloud");
    expect(BRAND_SHORT).toBe("Doma");
    expect(BRAND_TAGLINE).toMatch(/хранилище/i);
    expect(BRAND_TITLE).toContain(BRAND_NAME);
  });
});
