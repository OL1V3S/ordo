import { describe, expect, it } from "vitest";
import { formatHomeAmount, formatHomeDate, isHomeResponse } from "./homePresentation";

const item = {
  kind: "expense",
  recordId: 4,
  date: "2026-03-08",
  amount: "9999999999999999.99",
  description: "Rent",
  category: "housing",
  paycheck: null,
};

const response = {
  generatedAt: "2026-09-23T12:00:00Z",
  currencyCode: "USD",
  evaluations: { activityThroughDate: "2026-09-23", upcomingEvaluatedOn: "2026-09-23" },
  attention: { availability: { state: "available", reasonCode: null }, kindsEvaluated: [], items: [] },
  recentActivity: { availability: { state: "available", reasonCode: null }, items: [item] },
  upcoming: { availability: { state: "available", reasonCode: null }, horizon: { from: "2026-09-23", through: "2026-10-06" }, items: [] },
};

describe("Home presentation contract", () => {
  it("accepts the Home response and preserves empty versus unavailable activity", () => {
    expect(isHomeResponse(response)).toBe(true);
    expect(isHomeResponse({
      ...response,
      recentActivity: { availability: { state: "available", reasonCode: null }, items: [] },
    })).toBe(true);
    expect(isHomeResponse({
      ...response,
      recentActivity: { availability: { state: "unavailable", reasonCode: "source_unavailable" }, items: null },
    })).toBe(true);
    expect(isHomeResponse({
      ...response,
      recentActivity: { availability: { state: "available", reasonCode: null }, items: null },
    })).toBe(false);
  });

  it("rejects malformed and noncanonical financial values", () => {
    expect(isHomeResponse({
      ...response,
      recentActivity: { ...response.recentActivity, items: [{ ...item, amount: "1e2" }] },
    })).toBe(false);
    expect(formatHomeAmount("10000000000000000.00", "expense", "en-US")).toBeNull();
    expect(formatHomeAmount("1.2", "expense", "en-US")).toBeNull();
  });

  it("formats exact maximum amounts without Number conversion and localizes calendar dates", () => {
    expect(formatHomeAmount("9999999999999999.99", "expense", "en-US"))
      .toBe("−$9,999,999,999,999,999.99");
    expect(formatHomeAmount("1234.56", "account_inflow", "en-US")).toBe("+$1,234.56");
    expect(formatHomeDate("2026-03-08", "en-US")).toBe("Mar 8, 2026");
    expect(formatHomeDate("2026-03-08", "es-US")).toBe("8 mar 2026");
    expect(formatHomeDate("2026-02-29", "en-US")).toBeNull();
  });
});
