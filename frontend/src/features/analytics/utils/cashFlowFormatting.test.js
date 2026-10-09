import { describe, expect, it } from "vitest";
import { cashPercentage, formatCash } from "./cashFlowPresentation";
import { formatMonthLabel } from "./monthlySpendingInsights";

describe("cash-flow money and percentages by language", () => {
  it("keeps English output and shows USD with the code in Spanish", () => {
    expect(formatCash("-1500")).toBe("\u2212$15.00");
    expect(formatCash("-1500", { locale: "es" })).toBe("\u2212USD\u00a015.00");
    expect(formatCash("5000", { signed: true, locale: "es" })).toBe("+USD\u00a050.00");
    expect(formatCash("99999999999999999999", { locale: "en" })).toBe("$999,999,999,999,999,999.99");
  });

  it("keeps percentages ungrouped in both languages", () => {
    expect(cashPercentage("1", "3")).toBe("33.3%");
    expect(cashPercentage("1", "3", "es")).toBe("33.3%");
    expect(cashPercentage("12345", "1000")).toBe("1234.5%");
  });

  it("labels a month without a translator from the shared formatter", () => {
    expect(formatMonthLabel("2026-03")).toBe("March 2026");
    expect(formatMonthLabel("0050-01")).toBe("January 0050");
  });
});
