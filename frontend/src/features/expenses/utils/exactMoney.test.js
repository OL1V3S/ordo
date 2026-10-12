import { describe, expect, it } from "vitest";
import {
  AMOUNT_NEEDS_REVIEW,
  formatCents,
  formatExactMoney,
  formatSignedMoney,
  parseBudgetLimit,
  parseExpenseAmount,
  percentageFromRatio,
} from "./exactMoney";

describe("exact Expense money", () => {
  it.each([
    ["12", "12.00"], ["12.5", "12.50"], ["12.50", "12.50"],
    [".50", "0.50"], ["0012.50", "12.50"], [" 12.50 ", "12.50"],
    ["0.01", "0.01"], ["9999999999999999.99", "9999999999999999.99"],
  ])("normalizes %s without Number conversion", (input, expected) => {
    expect(parseExpenseAmount(input)?.value).toBe(expected);
  });

  it.each(["", "0", "0.00", "-1", "+1", "1.234", "1e2", "1,000", "$1", "10000000000000000.00"])(
    "rejects unsupported input %s", (input) => expect(parseExpenseAmount(input)).toBeNull()
  );

  it("accepts only legacy numeric values whose cents remain distinguishable", () => {
    expect(parseExpenseAmount(12.5)?.value).toBe("12.50");
    expect(parseExpenseAmount(Number("90071992547409.94"))).toBeNull();
    expect(formatExactMoney(Number("9999999999999999.99"))).toBe("Exact amount unavailable");
  });

  it("formats and derives percentages from exact minor units", () => {
    expect(formatCents(999999999999999999n)).toBe("$9,999,999,999,999,999.99");
    expect(formatCents(-125n)).toBe("-$1.25");
    expect(percentageFromRatio(9n, 10n)).toBe(90);
  });

  it("fails closed for an ambiguous BudgetLimit number", () => {
    expect(parseBudgetLimit(90.25)?.value).toBe("90.25");
    expect(parseBudgetLimit(2 ** 46 - 0.01)?.value).toBe("70368744177663.99");
    expect(parseBudgetLimit(2 ** 46)).toBeNull();
    expect(parseBudgetLimit(Number("9999999999999999"))).toBeNull();
    expect(parseBudgetLimit("90.25")).toBeNull();
  });
  it('formats cents in the requested language without changing the English output', () => {
    expect(formatCents(123456n)).toBe('$1,234.56')
    expect(formatCents(-125n, 'es')).toBe('-USD\u00a01.25')
    expect(formatExactMoney('1234.5', undefined, 'es')).toBe('USD\u00a01,234.50')
    expect(formatExactMoney('1234.5', { currency: false }, 'en')).toBe('1,234.50')
    expect(formatExactMoney('0', { allowZero: true })).toBe('$0.00')
    expect(formatExactMoney('abc', undefined, 'es')).toBe('Exact amount unavailable')
  })
});

describe("localized unavailable-amount label", () => {
  it("keeps the English constant as the default fallback", () => {
    expect(AMOUNT_NEEDS_REVIEW).toBe("Exact amount unavailable");
    expect(formatExactMoney("abc")).toBe("Exact amount unavailable");
    expect(formatSignedMoney("abc")).toBe("Exact amount unavailable");
    expect(formatSignedMoney("abc", "es")).toBe("Exact amount unavailable");
  });

  it("uses the caller's label for unreadable amounts and never for valid ones", () => {
    expect(formatExactMoney("abc", { unavailableLabel: "Monto exacto no disponible" }, "es")).toBe("Monto exacto no disponible");
    expect(formatExactMoney("1.005", { allowZero: true, unavailableLabel: "Monto exacto no disponible" }, "es")).toBe("Monto exacto no disponible");
    expect(formatExactMoney("1234.5", { unavailableLabel: "Monto exacto no disponible" }, "es")).toBe("USD\u00a01,234.50");
    expect(formatSignedMoney("x", "es", "Monto exacto no disponible")).toBe("Monto exacto no disponible");
    expect(formatSignedMoney("-1.25", "en", "unused")).toBe("-$1.25");
  });
});
