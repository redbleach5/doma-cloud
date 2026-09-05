import { describe, expect, it } from "bun:test";
import { dayPart, timeGreeting } from "@/lib/cloud/time-greeting";

function atHour(h: number): Date {
  return new Date(2026, 6, 14, h, 0, 0);
}

describe("dayPart", () => {
  it("maps hours to parts", () => {
    expect(dayPart(atHour(6))).toBe("morning");
    expect(dayPart(atHour(13))).toBe("day");
    expect(dayPart(atHour(19))).toBe("evening");
    expect(dayPart(atHour(23))).toBe("night");
    expect(dayPart(atHour(2))).toBe("night");
  });
});

describe("timeGreeting", () => {
  it("includes the display name in morning greetings", () => {
    const g = timeGreeting(atHour(8), "Анна");
    expect(g.line).toContain("Доброе утро");
    expect(g.line).toContain("Анна");
  });

  it("greets politely at night", () => {
    const g = timeGreeting(atHour(1), "Иван");
    expect(g.line).toContain("Спокойной ночи");
    expect(g.line).toContain("Иван");
  });

  it("works without a display name", () => {
    const g = timeGreeting(atHour(12));
    expect(g.line).toBe("Добрый день");
  });
});
