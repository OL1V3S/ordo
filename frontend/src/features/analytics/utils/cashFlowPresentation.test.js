import { describe, expect, it } from "vitest";
import { categoryTrend, cumulativeDays, previousMonth, categoryShares, netSeries, barWidth, cashDateLabel, cashMonthLabel, cashPercentage, formatCash, localThroughDate, minorUnits, periodNotes } from "./cashFlowPresentation";

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

describe("category shares and net series", () => {
  const cat = (category, amountMinor) => ({ category, amountMinor });
  it("orders like the list: amount descending, then name", () => {
    const shares = categoryShares([cat("b", "5"), cat("a", "5"), cat("c", "9")], "19");
    expect(shares.map((share) => share.category)).toEqual(["c", "a", "b"]);
    expect(shares.every((share) => !share.other)).toBe(true);
  });
  it("is empty without spending or categories", () => {
    expect(categoryShares([cat("a", "5")], "0")).toEqual([]);
    expect(categoryShares([], "100")).toEqual([]);
  });
  it("keeps six categories and groups seven or more into an exact Other", () => {
    const six = ["1", "2", "3", "4", "5", "6"].map((n) => cat(`c${n}`, n));
    expect(categoryShares(six, "21")).toHaveLength(6);
    const big = "999999999999999999";
    const shares = categoryShares([...six, cat("c7", big), cat("c8", "1")], "1000");
    expect(shares).toHaveLength(6);
    expect(shares[5]).toEqual({ category: null, amountMinor: "4", other: true, count: 3 });
    expect(shares[0].amountMinor).toBe(big);
  });
  it("percent label rounds like the list", () => {
    expect(cashPercentage("1", "16")).toBe("6.3%");
  });
  it("converts net to plot dollars, negative included", () => {
    expect(netSeries([{ netMinor: "15000" }, { netMinor: "-250" }, { netMinor: "0" }])).toEqual([150, -2.5, 0]);
  });
  it("accumulates days exactly above 2^53", () => {
    const big = "9007199254740993";
    const days = cumulativeDays({ days: [{ date: "2026-08-01", spentMinor: big }, { date: "2026-08-02", spentMinor: "2" }, { date: "2026-08-03", spentMinor: "0" }] });
    expect(days.map((day) => day.cumulativeMinor)).toEqual([big, "9007199254740995", "9007199254740995"]);
    expect(days[1].day).toBe(2);
    expect(days[0].plot).toBeTypeOf("number");
    expect(cumulativeDays({})).toEqual([]);
  });
  it("picks the previous month unless the window has one month", () => {
    expect(previousMonth([{ month: "a" }, { month: "b" }])).toEqual({ month: "a" });
    expect(previousMonth([{ month: "a" }])).toBeNull();
  });
  it("ranks category trend series and sums Other exactly", () => {
    const rows = (amounts) => amounts.map((amountMinor, index) => cat(`c${index + 1}`, amountMinor));
    const big = "999999999999999999";
    const months = [{ categories: rows(["1", "2", "3", "4", "5", "6", big]) }, { categories: rows(["1", "1"]) }, {}];
    const series = categoryTrend(months);
    expect(series).toHaveLength(6);
    expect(series[0]).toMatchObject({ category: "c7", other: false, amounts: [big, "0", "0"] });
    expect(series[5]).toMatchObject({ category: null, other: true, count: 2 });
    expect(series[5].amounts).toEqual(["4", "1", "0"]);
    expect(series[5].plot).toEqual([0.04, 0.01, 0]);
    expect(categoryTrend([{ categories: [] }, {}])).toEqual([]);
    expect(categoryTrend([{ categories: [cat("a", "0")] }])).toEqual([]);
  });
});
