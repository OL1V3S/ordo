import { describe, expect, it } from "vitest";
import {
  buildMonthlySpendingInsights,
  getAvailableMonths,
  getPreviousMonth,
} from "./monthlySpendingInsights";

const now = new Date(2026, 7, 14, 12, 0, 0);

describe("monthly spending insights", () => {
  it("derives represented historical months and preserves January rollover", () => {
    const expenses = [
      { date: "2026-07-02" },
      { date: "2025-12-31" },
      { date: "2026-09-01" },
      { date: "not-a-date" },
    ];
    expect(getAvailableMonths(expenses, now)).toEqual(["2026-08", "2026-07", "2025-12"]);
    expect(getPreviousMonth("2026-01")).toBe("2025-12");
  });

  it("ranks categories, compares the previous month, and excludes future current-month days", () => {
    const expenses = [
      { id: 1, description: "Groceries", category: "food", amount: 60, date: "2026-08-02" },
      { id: 2, description: "Bus", category: "transport", amount: 40, date: "2026-08-03" },
      { id: 3, description: "Future", category: "food", amount: 500, date: "2026-08-15" },
      { id: 4, description: "July food", category: "food", amount: 25, date: "2026-07-03" },
      { id: 5, description: "July bills", category: "bills", amount: 75, date: "2026-07-04" },
    ];
    const result = buildMonthlySpendingInsights(expenses, "2026-08", now);

    expect(result.total).toBe("100.00");
    expect(result.categories).toEqual([
      { category: "food", amount: "60.00", percentage: 60 },
      { category: "transport", amount: "40.00", percentage: 40 },
    ]);
    expect(result.comparison).toEqual({ previousTotal: "100.00", difference: "0.00", isIncrease: false, percentage: 0 });
    expect(result.increases).toEqual([
      { category: "transport", difference: "40.00" },
      { category: "food", difference: "35.00" },
    ]);
    expect(result.decreases).toEqual([{ category: "bills", difference: "-75.00" }]);
  });

  it("does not invent a percentage when the previous month is zero and caps largest expenses at five", () => {
    const expenses = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      description: `Expense ${index + 1}`,
      category: "food",
      amount: index + 1,
      date: "2026-08-01",
    }));
    const result = buildMonthlySpendingInsights(expenses, "2026-08", now);

    expect(result.comparison.percentage).toBeNull();
    expect(result.largestExpensesAvailable).toBe(true);
    expect(result.largestExpenses.map(({ amount }) => amount)).toEqual([7, 6, 5, 4, 3]);
  });

  it("uses deterministic amount, date, and id ordering for largest expenses", () => {
    const result = buildMonthlySpendingInsights([
      { id: 3, description: "Third", category: "food", amount: 10, date: "2026-08-03" },
      { id: 2, description: "Second", category: "food", amount: 10, date: "2026-08-03" },
      { id: 1, description: "First", category: "food", amount: 10, date: "2026-08-02" },
    ], "2026-08", now);
    expect(result.largestExpenses.map(({ id }) => id)).toEqual([2, 3, 1]);
  });

  it("preserves unavailable category totals and suppresses rankings when a legacy amount is ambiguous", () => {
    const result = buildMonthlySpendingInsights([
      { id: 1, description: "Ambiguous", category: "food", amount: Number("9999999999999999"), date: "2026-08-02" },
      { id: 2, description: "Known smaller", category: "food", amount: "10.00", date: "2026-08-03" },
      { id: 3, description: "July food", category: "food", amount: "20.00", date: "2026-07-03" },
    ], "2026-08", now);

    expect(result.available).toBe(false);
    expect(result.totalsByCategory.food).toBeNull();
    expect(result.increases).toEqual([]);
    expect(result.decreases).toEqual([]);
    expect(result.largestExpensesAvailable).toBe(false);
    expect(result.largestExpenses).toEqual([]);
  });
});
