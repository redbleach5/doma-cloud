/**
 * Russian pluralization helper.
 *
 * Picks the right word form for a count, e.g.:
 *   plural(1, "день", "дня", "дней")  → "день"
 *   plural(2, "день", "дня", "дней")  → "дня"
 *   plural(5, "день", "дня", "дней")  → "дней"
 *
 * one — for counts ending in 1 (except 11)
 * few — for counts ending in 2-4 (except 12-14)
 * many — everything else
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
