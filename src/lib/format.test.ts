import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatRange, parseClock } from "./format";

describe("formatage", () => {
  it("lit et écrit les allures en min:s", () => {
    expect(parseClock("5:30")).toBe(330);
    expect(parseClock("5'30")).toBe(330);
    expect(parseClock("1:45")).toBe(105);
    expect(parseClock("330")).toBe(330);
    expect(parseClock("abc")).toBeNull();
    expect(formatClock(330)).toBe("5:30");
    expect(formatClock(65)).toBe("1:05");
  });

  it("affiche toujours l'unité", () => {
    expect(formatRange("hr", 116, 136)).toBe("116–136 bpm");
    expect(formatRange("pace", 250, 286)).toBe("4:10–4:46 /km");
    expect(formatRange("power", 362, null)).toBe("≥ 362 W");
    expect(formatRange("swim_pace", 124, null)).toBe("plus vite que 2:04 /100 m");
    expect(formatDuration(5400)).toBe("1 h 30");
    expect(formatDuration(2700)).toBe("45 min");
  });
});
