import { describe, expect, it } from "vitest";
import { periodRange, timelineFilterParams } from "./timelineFilter";

// Dates are built from local calendar parts, so these hold in any timezone.
describe("periodRange", () => {
  it("returns empty bounds for all and null for custom", () => {
    expect(periodRange("all", new Date(2026, 8, 15, 12))).toEqual({ from: "", to: "" });
    expect(periodRange("custom", new Date(2026, 8, 15, 12))).toBeNull();
  });
  it("computes last 7 and last 30 days inclusive of today", () => {
    const now = new Date(2026, 8, 15, 12);
    expect(periodRange("last7", now)).toEqual({ from: "2026-09-09", to: "2026-09-15" });
    expect(periodRange("last30", now)).toEqual({ from: "2026-08-17", to: "2026-09-15" });
  });
  it("uses the local calendar day just after and just before midnight", () => {
    expect(periodRange("last7", new Date(2026, 8, 15, 0, 5)).to).toBe("2026-09-15");
    expect(periodRange("last7", new Date(2026, 8, 15, 23, 55)).to).toBe("2026-09-15");
    expect(periodRange("last7", new Date(2026, 8, 15, 23, 55)).from).toBe("2026-09-09");
  });
  it("crosses a year boundary", () => {
    expect(periodRange("last7", new Date(2026, 0, 3, 10))).toEqual({ from: "2025-12-28", to: "2026-01-03" });
  });
  it("covers the whole month including month ends and leap February", () => {
    expect(periodRange("thisMonth", new Date(2026, 0, 31, 23, 59))).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(periodRange("thisMonth", new Date(2026, 8, 1, 0, 1))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("thisMonth", new Date(2028, 1, 10, 9))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("thisMonth", new Date(2026, 1, 10, 9))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("thisMonth", new Date(2026, 11, 31, 23))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("sends only the existing q/kind/from/to parameters for each preset", () => {
    for (const period of ["last7", "last30", "thisMonth"]) {
      const range = periodRange(period, new Date(2026, 8, 15, 12));
      expect(timelineFilterParams({ q: "", kind: "", ...range })).toEqual(range);
    }
  });
});
