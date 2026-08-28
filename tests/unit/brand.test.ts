import { describe, expect, it } from "bun:test";
import {
  BRAND_NAME,
  BRAND_SHORT,
  BRAND_TAGLINE,
  BRAND_TITLE,
} from "@/lib/cloud/brand";

describe("brand", () => {
  it("uses the Russian product name", () => {
    expect(BRAND_NAME).toBe("Наша история");
    expect(BRAND_SHORT).toBe("История");
    expect(BRAND_TAGLINE).toMatch(/архив/i);
    expect(BRAND_TITLE).toContain(BRAND_NAME);
  });
});
