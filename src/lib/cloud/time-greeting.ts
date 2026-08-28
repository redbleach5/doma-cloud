/**
 * Warm time-of-day lines for the header — family tone, not corporate.
 * Returns a short headline; optional support line can be shown on wide screens.
 */

export type DayPart = "morning" | "day" | "evening" | "night";

export function dayPart(now = new Date()): DayPart {
  const h = now.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export interface TimeGreeting {
  part: DayPart;
  /** Compact line always shown near the brand. */
  line: string;
  /** Softer support line — desktop / wide only. */
  sub: string;
}

export function timeGreeting(now = new Date(), displayName?: string): TimeGreeting {
  const part = dayPart(now);
  const name = displayName?.trim();
  const hello = name ? `, ${name}` : "";

  switch (part) {
    case "morning":
      return {
        part,
        line: `Доброе утро${hello}`,
        sub: "Фото с холодильника всё ещё ждут своих героев.",
      };
    case "day":
      return {
        part,
        line: `Добрый день${hello}`,
        sub: "Архив на месте. Можно не торопиться.",
      };
    case "evening":
      return {
        part,
        line: `Добрый вечер${hello}`,
        sub: "Хорошее время полистать старые снимки.",
      };
    case "night":
      return {
        part,
        line: name ? `Спокойной ночи${hello}` : "Спокойной ночи",
        sub: "Тихая ночь. Всё на месте.",
      };
  }
}
