import { describe, expect, it } from "vitest";
import { cadenceLabel, formatAmount, formatDate, formatMoney, formatSchedule, formatWindow } from "./formatPaychecks";

describe("paycheck display formatting", () => {
  it("keeps date-only calendar days through DST dates and early years", () => {
    expect(formatDate("2026-03-08")).toBe("Mar 8, 2026");
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026");
    expect(formatDate("0001-01-01")).toBe("Jan 1, 0001");
    expect(formatDate("2026-02-29")).toBe("Unknown date");
  });
  it("formats money without inventing cents discarded by JSON numeric parsing", () => {
    expect(formatMoney(1234.56)).toBe("$1,234.56");
    expect(formatMoney("9999999999999999.99")).toBe("$9,999,999,999,999,999.99");
    expect(formatMoney(1e16)).toBe("Amount needs review");
    expect(formatMoney(Number("70368744177664.01"))).toBe("Amount needs review");
    expect(formatMoney(null)).toBe("Amount unavailable");
    expect(formatAmount({ mode: "range", minimumAmount: "100.01", maximumAmount: "200.99" })).toBe("$100.01 – $200.99");
  });
  it("distinguishes all schedules and month end", () => {
    expect(cadenceLabel("biweekly")).toBe("Every two weeks");
    expect(formatSchedule({ cadence: "weekly", referenceAnchorDate: "2026-01-02" })).toBe("Weekly, reference date Jan 2, 2026");
    expect(formatSchedule({ cadence: "biweekly", referenceAnchorDate: "2026-01-02" })).toContain("Every two weeks");
    expect(formatSchedule({ cadence: "monthly", firstMonthAnchor: { kind: "month_end", day: null } })).toBe("Monthly, month end");
    expect(formatSchedule({ cadence: "semimonthly", firstMonthAnchor: { kind: "day_of_month", day: 15 }, secondMonthAnchor: { kind: "month_end", day: null } }))
      .toBe("Twice a month, day 15 and month end");
    expect(formatWindow(1, 3)).toBe("1 day before · 3 days after");
  });
  it("shows negative zero without a sign and keeps real negatives", () => {
    expect(formatMoney("-0.00")).toBe("$0.00");
    expect(formatMoney("-0.50")).toBe("-$0.50");
    expect(formatMoney("12.5")).toBe("$12.50");
  });
  it("formats dates in the requested language and keeps four-digit years", () => {
    expect(formatDate("2026-03-08", undefined, "es")).toBe("8 mar 2026");
    expect(formatDate("0099-03-08", undefined, "en")).toBe("Mar 8, 0099");
  });
});
