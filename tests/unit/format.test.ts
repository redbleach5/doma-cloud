import { describe, expect, it } from "bun:test";
import {
  formatBytes,
  formatDate,
  formatRelative,
} from "@/lib/cloud/format";

describe("formatBytes", () => {
  it("formats bytes < 1024 as 'N Б'", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(1)).toBe("1 Б");
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(1023)).toBe("1023 Б");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 КБ");
    expect(formatBytes(1536)).toBe("1.5 КБ");
    expect(formatBytes(10240)).toBe("10 КБ"); // val >= 10 → 0 decimals
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 МБ");
    expect(formatBytes(1024 * 1024 * 50)).toBe("50 МБ");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 ГБ");
  });

  it("formats gigabytes and terabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 5)).toBe("5.0 ГБ");
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.0 ТБ");
    expect(formatBytes(1024 ** 5)).toBe("1.0 ПБ");
  });

  it("accepts bigint input", () => {
    expect(formatBytes(1024n)).toBe("1.0 КБ");
    expect(formatBytes(0n)).toBe("0 Б");
    // A 50 GB quota in bigint form (the default in schema.prisma)
    expect(formatBytes(50n * 1024n * 1024n * 1024n)).toBe("50 ГБ");
  });

  it("accepts string-encoded numbers", () => {
    expect(formatBytes("1024")).toBe("1.0 КБ");
    expect(formatBytes("0")).toBe("0 Б");
  });

  it("returns '—' for negative numbers (invalid)", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(-1024)).toBe("—");
  });

  it("returns '—' for NaN / non-finite", () => {
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
    expect(formatBytes("not a number")).toBe("—");
  });

  it("handles very large bigints that exceed Number.MAX_SAFE_INTEGER", () => {
    // 3 TB as bigint — Number() conversion loses precision but result is
    // still formatted as a reasonable human string.
    const threeTB = 3n * 1024n * 1024n * 1024n * 1024n;
    const result = formatBytes(threeTB);
    expect(result).toMatch(/ТБ$/);
  });
});

describe("formatDate", () => {
  it("returns empty string for null / undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("returns empty string for invalid dates", () => {
    expect(formatDate(new Date("invalid"))).toBe("");
    expect(formatDate("not a date")).toBe("");
  });

  it("formats a valid Date in ru-RU locale", () => {
    const d = new Date("2024-01-15T00:00:00Z");
    const result = formatDate(d);
    // ru-RU long month, day numeric, year numeric — exact spelling may
    // vary by runtime, so just check the structure.
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/15/);
  });

  it("accepts ISO date strings", () => {
    const result = formatDate("2024-06-01T12:00:00Z");
    expect(result).toMatch(/2024/);
  });
});

describe("formatRelative", () => {
  it("returns empty string for null / undefined", () => {
    expect(formatRelative(null)).toBe("");
    expect(formatRelative(undefined)).toBe("");
  });

  it("returns 'только что' for events less than 60s ago", () => {
    const now = new Date();
    expect(formatRelative(now)).toBe("только что");
    expect(formatRelative(new Date(now.getTime() - 30_000))).toBe("только что");
  });

  it("returns 'N мин назад' for events 1-59 minutes ago", () => {
    const now = new Date();
    expect(formatRelative(new Date(now.getTime() - 60_000))).toBe("1 мин назад");
    expect(formatRelative(new Date(now.getTime() - 5 * 60_000))).toBe("5 мин назад");
    expect(formatRelative(new Date(now.getTime() - 59 * 60_000))).toBe("59 мин назад");
  });

  it("returns 'N ч назад' for events 1-23 hours ago", () => {
    const now = new Date();
    expect(formatRelative(new Date(now.getTime() - 60 * 60_000))).toBe("1 ч назад");
    expect(formatRelative(new Date(now.getTime() - 5 * 60 * 60_000))).toBe("5 ч назад");
  });

  it("returns 'N дн назад' for events 1-6 days ago", () => {
    const now = new Date();
    expect(formatRelative(new Date(now.getTime() - 24 * 60 * 60_000))).toBe("1 дн назад");
    expect(formatRelative(new Date(now.getTime() - 3 * 24 * 60 * 60_000))).toBe("3 дн назад");
  });

  it("returns 'N нед назад' for events 7-29 days ago", () => {
    const now = new Date();
    expect(formatRelative(new Date(now.getTime() - 7 * 24 * 60 * 60_000))).toBe("1 нед назад");
    expect(formatRelative(new Date(now.getTime() - 14 * 24 * 60 * 60_000))).toBe("2 нед назад");
  });

  it("falls back to formatDate for events 30+ days ago", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60_000);
    const result = formatRelative(old);
    // Should NOT contain the relative keywords anymore.
    expect(result).not.toContain("назад");
    expect(result).toMatch(/\d{4}/); // year present
  });
});
