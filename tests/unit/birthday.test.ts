import { describe, expect, it } from "bun:test";
import {
  toBirthdayIso,
  birthdayDateInputValue,
  normalizeBirthdayDate,
  isBirthdayToday,
  isSameUtcMonthDay,
  isLocalMonthDay,
  birthdayAgeYears,
  localDateKey,
} from "@/lib/cloud/birthday";

describe("birthday helpers", () => {
  it("encodes date-input as UTC noon so the calendar day never shifts", () => {
    expect(toBirthdayIso("1995-03-20")).toBe("1995-03-20T12:00:00.000Z");
    expect(birthdayDateInputValue(toBirthdayIso("1995-03-20"))).toBe("1995-03-20");
  });

  it("normalizes midnight-UTC and date-only to noon", () => {
    expect(normalizeBirthdayDate("1995-03-20T00:00:00.000Z").toISOString()).toBe(
      "1995-03-20T12:00:00.000Z"
    );
    expect(normalizeBirthdayDate("1995-03-20").toISOString()).toBe(
      "1995-03-20T12:00:00.000Z"
    );
  });

  it("round-trips through toISOString without turning Mar 20 into Mar 19", () => {
    // The old bug: new Date("1995-03-20T00:00:00").toISOString() in UTC+3 → Mar 19.
    const stored = toBirthdayIso("1995-03-20");
    expect(stored.slice(0, 10)).toBe("1995-03-20");
    expect(birthdayDateInputValue(stored)).toBe("1995-03-20");
  });

  it("isBirthdayToday matches local calendar day of the stored birthday", () => {
    const birthday = toBirthdayIso("1990-07-13");
    const onDay = new Date(2026, 6, 13, 15, 0, 0); // local Jul 13
    const otherDay = new Date(2026, 6, 14, 10, 0, 0);
    expect(isBirthdayToday(birthday, onDay)).toBe(true);
    expect(isBirthdayToday(birthday, otherDay)).toBe(false);
  });

  it("birthdayAgeYears does not increment before this year's birthday", () => {
    expect(birthdayAgeYears(toBirthdayIso("1990-05-15"), new Date(2026, 0, 1))).toBe(35);
    expect(birthdayAgeYears(toBirthdayIso("1990-05-15"), new Date(2026, 4, 15))).toBe(36);
    expect(birthdayAgeYears(toBirthdayIso("1990-05-15"), new Date(2026, 11, 1))).toBe(36);
  });

  it("normalizeBirthdayDate(Date) uses local calendar day", () => {
    // Local Mar 20 00:00 — must not become Mar 19 via toISOString in UTC+.
    const local = new Date(1995, 2, 20, 0, 0, 0);
    expect(normalizeBirthdayDate(local).toISOString()).toBe("1995-03-20T12:00:00.000Z");
  });

  it("normalizeBirthdayDate keeps day from offset strings", () => {
    expect(normalizeBirthdayDate("1995-03-20T00:00:00+03:00").toISOString()).toBe(
      "1995-03-20T12:00:00.000Z"
    );
  });

  it("isLocalMonthDay matches local anniversary", () => {
    const created = new Date(2024, 6, 13, 22, 0, 0); // local Jul 13
    expect(isLocalMonthDay(created, new Date(2026, 6, 13))).toBe(true);
    expect(isLocalMonthDay(created, new Date(2026, 6, 14))).toBe(false);
  });

  it("isSameUtcMonthDay compares UTC month/day", () => {
    const created = new Date("2024-07-13T22:30:00.000Z");
    const sameUtc = new Date("2026-07-13T01:00:00.000Z");
    const otherUtc = new Date("2026-07-14T01:00:00.000Z");
    expect(isSameUtcMonthDay(created, sameUtc)).toBe(true);
    expect(isSameUtcMonthDay(created, otherUtc)).toBe(false);
  });

  it("localDateKey formats local YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 0, 0))).toBe("2026-01-05");
  });
});
