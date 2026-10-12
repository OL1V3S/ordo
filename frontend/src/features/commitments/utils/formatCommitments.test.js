import { describe, expect, it } from "vitest";
import { formatDate, formatDerivedMoney, formatMoney } from "./formatCommitments";

describe("commitment display formatting", () => {
  it("formats valid expected amounts in the requested language", () => {
    expect(formatMoney("1200.00")).toBe("$1,200.00");
    expect(formatMoney(1200.5)).toBe("$1,200.50");
    expect(formatMoney("1200", "es")).toBe("USD\u00a01,200.00");
    expect(formatDerivedMoney("20.00", "es")).toBe("USD\u00a020.00");
  });

  it("shows the existing review label instead of a fabricated amount", () => {
    for (const value of [null, undefined, "", "abc", "1.005"]) {
      expect(formatMoney(value)).toBe("Amount needs review");
      expect(formatMoney(value, "es")).toBe("Amount needs review");
    }
  });

  it("formats dates in the requested language with the unknown-date fallback", () => {
    expect(formatDate("2026-03-04")).toBe("Mar 4, 2026");
    expect(formatDate("2026-03-04", undefined, "es")).toBe("4 mar 2026");
    expect(formatDate(null)).toBe("Unknown date");
    expect(formatDate("not a date")).toBe("Unknown date");
  });
});
