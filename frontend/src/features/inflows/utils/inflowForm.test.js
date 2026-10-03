import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatInflowDate,
  formatInflowMoney,
  initialInflowDraft,
  isUnsafeAmount,
  validateInflow,
} from "./inflowForm";

describe("inflow form contracts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 23, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("starts a new draft on the local calendar day", () => {
    expect(initialInflowDraft()).toEqual({ description: "", amount: "", date: "2026-09-08" });
  });

  it("preserves safe edit values but leaves an unsafe numeric amount blank", () => {
    expect(initialInflowDraft({ description: "IRS refund", amount: 12.35, date: "2026-09-01" }))
      .toEqual({ description: "IRS refund", amount: "12.35", date: "2026-09-01" });
    expect(initialInflowDraft({ description: "Large transfer", amount: 2 ** 46, date: "2026-09-02" }).amount).toBe("");
  });

  it("trims only the outside of a description and preserves exact decimal strings", () => {
    expect(validateInflow({ description: "  Client   reimbursement  ", amount: "0012.30", date: "2026-09-08" }))
      .toEqual({ errors: {}, payload: {
        description: "Client   reimbursement",
        amount: "12.30",
        date: "2026-09-08",
      } });
    expect(validateInflow({ description: "Deposit", amount: ".50", date: "2026-09-08" }).payload.amount).toBe("0.50");
  });

  it.each(["", " ", "0", "-1", "1.001", "1.", "1e2", "1,000", "NaN", "Infinity", "10000000000000000", "9999999999999999.991"])(
    "rejects invalid amount %s without rounding",
    (amount) => {
      const result = validateInflow({ description: "Deposit", amount, date: "2026-09-08" });
      expect(result.payload).toBeNull();
      expect(result.errors.amount).toBeTruthy();
    },
  );

  it("accepts the exact maximum without converting it to Number", () => {
    const result = validateInflow({
      description: "Maximum",
      amount: "9999999999999999.99",
      date: "9999-12-31",
    });
    expect(result).toEqual({ errors: {}, payload: {
      description: "Maximum",
      amount: "9999999999999999.99",
      date: "9999-12-31",
    } });
  });

  it("requires a trimmed description no longer than 500 characters", () => {
    expect(validateInflow({ description: "   ", amount: "1", date: "2026-09-08" }).errors.description).toBeTruthy();
    expect(validateInflow({ description: ` ${"x".repeat(500)} `, amount: "1", date: "2026-09-08" }).payload.description)
      .toHaveLength(500);
    expect(validateInflow({ description: "x".repeat(501), amount: "1", date: "2026-09-08" }).errors.description).toBeTruthy();
  });

  it.each(["2024-02-29", "0001-01-01", "2026-03-08", "2026-11-01", "9999-12-31"])(
    "accepts calendar date %s without a future ceiling",
    (date) => expect(validateInflow({ description: "Deposit", amount: "1", date }).errors.date).toBeUndefined(),
  );

  it.each(["", "2026-02-29", "0000-01-01", "2026-04-31", "2026-13-01", "2026-1-01", "2026-01-01T00:00:00Z"])(
    "rejects invalid calendar date %s",
    (date) => expect(validateInflow({ description: "Deposit", amount: "1", date }).errors.date).toBeTruthy(),
  );

  it("formats exact money and refuses unsafe or malformed values without auto-rounding", () => {
    expect(formatInflowMoney(1234.56)).toBe("$1,234.56");
    expect(formatInflowMoney("9999999999999999.99")).toBe("$9,999,999,999,999,999.99");
    expect(formatInflowMoney(Number("70368744177664.01"))).toBe("Amount needs review");
    expect(formatInflowMoney(0.1 + 0.2)).toBe("Amount needs review");
    expect(formatInflowMoney(null)).toBe("Amount needs review");
    expect(isUnsafeAmount(2 ** 46)).toBe(true);
    expect(isUnsafeAmount((2 ** 46) - 1)).toBe(false);
  });

  it("formats valid calendar dates without creating timezone-bearing instants", () => {
    expect(formatInflowDate("2026-03-08")).toBe("03/08/2026");
    expect(formatInflowDate("2026-11-01")).toBe("11/01/2026");
    expect(formatInflowDate("0001-01-01")).toBe("01/01/0001");
    expect(formatInflowDate("2026-02-29")).toBe("Unknown date");
  });

  it("returns caller-supplied fallback labels for unreviewable money and unknown dates", () => {
    expect(formatInflowMoney(null, "El monto requiere revisión")).toBe("El monto requiere revisión");
    expect(formatInflowMoney(Number("70368744177664.01"), "El monto requiere revisión")).toBe("El monto requiere revisión");
    expect(formatInflowMoney(1234.56, "El monto requiere revisión")).toBe("$1,234.56");
    expect(formatInflowDate("2026-02-29", "Fecha desconocida")).toBe("Fecha desconocida");
    expect(formatInflowDate("2026-03-08", "Fecha desconocida")).toBe("03/08/2026");
  });

  it("handles malformed non-string drafts and display inputs without throwing", () => {
    expect(() => validateInflow({ description: {}, amount: {}, date: {} })).not.toThrow();
    expect(validateInflow(null).payload).toBeNull();
    expect(initialInflowDraft({ description: {}, amount: {}, date: {} }))
      .toEqual({ description: "", amount: "", date: "" });
    expect(formatInflowMoney({})).toBe("Amount needs review");
    expect(formatInflowDate({})).toBe("Unknown date");
  });
});
