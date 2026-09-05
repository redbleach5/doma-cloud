/**
 * Time-of-day greeting for the header.
 * Returns a short headline for the current time of day.
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
}

export function timeGreeting(now = new Date(), displayName?: string): TimeGreeting {
  const part = dayPart(now);
  const name = displayName?.trim();
  const hello = name ? `, ${name}` : "";

  switch (part) {
    case "morning":
      return { part, line: `Доброе утро${hello}` };
    case "day":
      return { part, line: `Добрый день${hello}` };
    case "evening":
      return { part, line: `Добрый вечер${hello}` };
    case "night":
      return {
        part,
        line: name ? `Спокойной ночи${hello}` : "Спокойной ночи",
      };
  }
}
