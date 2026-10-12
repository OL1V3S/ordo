import { describe, expect, it } from "vitest";
import { barWidth, cashDateLabel, cashMonthLabel, cashPercentage, formatCash, localThroughDate, minorUnits, periodNotes } from "./cashFlowPresentation";

describe("exact cash-flow presentation", () => {
  it.each([
    ["0", "$0.00"], ["1", "$0.01"], ["-1", "−$0.01"],
    ["999999999999999999", "$9,999,999,999,999,999.99"],
    ["2999999999999999997", "$29,999,999,999,999,999.97"],
  ])("formats %s without losing cents", (value, expected) => expect(formatCash(value)).toBe(expected));
  it("preserves signed net without calling zero positive", () => {
    expect(formatCash("100", { signed: true })).toBe("+$1.00");
    expect(formatCash("-100", { signed: true })).toBe("−$1.00");
    expect(formatCash("0", { signed: true })).toBe("$0.00");
  });
  it.each(["01", "-0", "+1", "1.2", "1e2", 100, null])("rejects noncanonical cent input %s", (value) => {
    expect(() => minorUnits(value)).toThrow("Invalid cash-flow amount");
  });
  it("rounds exact percentages halfway up and keeps overspending and tiny denominators", () => {
    expect(cashPercentage("1", "16")).toBe("6.3%");
    expect(cashPercentage("1", "3")).toBe("33.3%");
    expect(cashPercentage("151", "100")).toBe("151.0%");
    expect(cashPercentage("999999999999999999", "1")).toBe("99999999999999999900.0%");
    expect(cashPercentage("0", "100")).toBe("0.0%");
    expect(cashPercentage("100", "0")).toBeNull();
    expect(cashPercentage("0", "0")).toBeNull();
  });
  it("scales both stacked components against the same maximum", () => {
    expect(barWidth("12000", "30000")).toBe("40%");
    expect(barWidth("3000", "30000")).toBe("10%");
    expect(barWidth("30000", "30000")).toBe("100%");
    expect(barWidth("0", "0")).toBe("0%");
  });
  it("uses local calendar fields, never UTC serialization", () => {
    const date = { getFullYear: () => 2026, getMonth: () => 7, getDate: () => 14,
      toISOString: () => { throw new Error("UTC conversion must not run"); } };
    expect(localThroughDate(date)).toBe("2026-08-14");
  });
  it("formats representable calendar edges without the Date constructor year remapping", () => {
    expect(cashMonthLabel("0001-01")).toBe("January 0001");
    expect(cashDateLabel("0001-01-01")).toBe("January 1, 0001");
    expect(cashMonthLabel("9999-12", { short: true })).toBe("Dec 9999");
    expect(cashDateLabel("2024-02-29")).toBe("February 29, 2024");
  });
  it("reports only factual period notes", () => {
    expect(periodNotes({ month: "2026-08", to: "2026-08-14", cashInMinor: "0", spentMinor: "0" }, "2026-08-14"))
      .toBe("Through August 14, 2026 · No deposits recorded · No spending recorded");
    expect(periodNotes({ month: "2026-07", cashInMinor: "100", spentMinor: "100" }, "2026-08-14")).toBe("—");
  });
});
