import { describe, expect, it } from "vitest";
import { getMonthYear, shiftMonthYear } from "./monthYear";

describe("shiftMonthYear", () => {
  it("shifts within and across years", () => {
    expect(shiftMonthYear("2026-08", -1)).toBe("2026-07");
    expect(shiftMonthYear("2026-08", 1)).toBe("2026-09");
    expect(shiftMonthYear("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthYear("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthYear("2026-08", 12)).toBe("2027-08");
    expect(shiftMonthYear("2026-08", -12)).toBe("2025-08");
    expect(shiftMonthYear("2026-08", 0)).toBe("2026-08");
  });

  it("matches the getMonthYear format", () => {
    expect(shiftMonthYear("2026-08", 0)).toBe(getMonthYear(new Date(2026, 7, 15)));
    expect(shiftMonthYear("2026-08", -7)).toBe(getMonthYear(new Date(2026, 0, 1)));
  });

  it("returns an empty string for invalid input", () => {
    expect(shiftMonthYear("", 1)).toBe("");
    expect(shiftMonthYear("2026-13", 1)).toBe("");
    expect(shiftMonthYear("2026-8", 1)).toBe("");
    expect(shiftMonthYear(null, 1)).toBe("");
    expect(shiftMonthYear("2026-08", 1.5)).toBe("");
  });
});
