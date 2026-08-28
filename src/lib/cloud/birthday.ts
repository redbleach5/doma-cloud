/**
 * Birthday is a calendar date (month + day), not a point in time.
 *
 * We store it as UTC noon (`YYYY-MM-DDT12:00:00.000Z`) so the calendar day
 * survives `.toISOString()` + `slice(0, 10)` round-trips in any timezone.
 * Saving local midnight (e.g. Moscow) used to shift the day back by one.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Encode a date-input value (`YYYY-MM-DD`) as a stable birthday Instant. */
export function toBirthdayIso(yyyyMmDd: string): string {
  const day = yyyyMmDd.trim().slice(0, 10);
  if (!DATE_ONLY.test(day)) {
    throw new Error(`Неверная дата рождения: ${yyyyMmDd}`);
  }
  return `${day}T12:00:00.000Z`;
}

/** Date for `<input type="date">` from a stored birthday ISO string. */
export function birthdayDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/**
 * Normalize any incoming birthday datetime / date-only string to UTC noon
 * of its calendar day.
 *
 * - `YYYY-MM-DD` → that day at noon UTC
 * - ISO string → first 10 chars (calendar prefix as sent)
 * - `Date` → local calendar day (avoids Moscow midnight → previous UTC day)
 */
export function normalizeBirthdayDate(input: string | Date): Date {
  if (input instanceof Date) {
    return new Date(toBirthdayIso(localDateKey(input)));
  }
  const trimmed = input.trim();
  if (DATE_ONLY.test(trimmed)) {
    return new Date(toBirthdayIso(trimmed));
  }
  const day = trimmed.slice(0, 10);
  if (!DATE_ONLY.test(day)) {
    throw new Error(`Неверная дата рождения: ${input}`);
  }
  return new Date(toBirthdayIso(day));
}

/** Local calendar `YYYY-MM-DD` — for dismiss keys (“закрыл сегодня”). */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Is today (local calendar) the birthday?
 * Birthday is compared by its stored calendar day (UTC noon → YYYY-MM-DD).
 */
export function isBirthdayToday(
  birthdayIso: string,
  now: Date = new Date()
): boolean {
  const day = birthdayDateInputValue(birthdayIso);
  if (!DATE_ONLY.test(day)) return false;
  const [, mm, dd] = day.split("-").map(Number);
  return now.getMonth() + 1 === mm && now.getDate() === dd;
}

/** Same UTC month+day (legacy; prefer isLocalMonthDay for UX). */
export function isSameUtcMonthDay(
  a: string | Date,
  b: Date = new Date()
): boolean {
  const da = typeof a === "string" ? new Date(a) : a;
  if (Number.isNaN(da.getTime())) return false;
  return da.getUTCMonth() === b.getUTCMonth() && da.getUTCDate() === b.getUTCDate();
}

/** Same local month+day — used for account anniversary greetings. */
export function isLocalMonthDay(
  a: string | Date,
  b: Date = new Date()
): boolean {
  const da = typeof a === "string" ? new Date(a) : a;
  if (Number.isNaN(da.getTime())) return false;
  return da.getMonth() === b.getMonth() && da.getDate() === b.getDate();
}

/**
 * Whole years from birthday calendar date to local today.
 * Subtracts one if this year's birthday has not occurred yet.
 */
export function birthdayAgeYears(
  birthdayIso: string,
  now: Date = new Date()
): number {
  const day = birthdayDateInputValue(birthdayIso);
  if (!DATE_ONLY.test(day)) return 0;
  const [year, mm, dd] = day.split("-").map(Number);
  if (!Number.isFinite(year)) return 0;
  let age = now.getFullYear() - year;
  const birthdayPassed =
    now.getMonth() + 1 > mm ||
    (now.getMonth() + 1 === mm && now.getDate() >= dd);
  if (!birthdayPassed) age -= 1;
  return Math.max(0, age);
}
