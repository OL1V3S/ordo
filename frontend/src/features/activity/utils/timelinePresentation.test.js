import { describe, expect, it } from "vitest";
import {
  formatTimelineAmount,
  formatTimelineDate,
  isActivityTimelinePage,
  timelineItemKey,
} from "./timelinePresentation";

const expense = (overrides = {}) => ({
  kind: "expense", recordId: 1, date: "2026-09-22", amount: "12.34",
  description: "Coffee", category: "food", paycheck: null, ...overrides,
});
const inflow = (overrides = {}) => ({
  kind: "account_inflow", recordId: 2, date: "2026-09-22", amount: "2500.00",
  description: "Payroll", category: null,
  paycheck: { profileId: "11111111-1111-1111-1111-111111111111", relation: "recorded_receipt" }, ...overrides,
});
const page = (items, overrides = {}) => ({
  currencyCode: "USD", items, page: { limit: 25, hasMore: false, nextCursor: null }, ...overrides,
});

describe("isActivityTimelinePage", () => {
  it("accepts a well-formed page, an empty page, and a page with more", () => {
    expect(isActivityTimelinePage(page([expense(), inflow()]))).toBe(true);
    expect(isActivityTimelinePage(page([]))).toBe(true);
    expect(isActivityTimelinePage(page([expense()], { page: { limit: 1, hasMore: true, nextCursor: "abc" } }))).toBe(true);
  });

  it.each(["0.00", "-5.00", "007.00", "99999999999999999999.99"])(
    "accepts the stored amount %s so only that row degrades, never the page", (amount) => {
      expect(isActivityTimelinePage(page([expense({ amount })]))).toBe(true);
    });

  it.each([
    ["unknown kind", expense({ kind: "transfer" })],
    ["zero record id", expense({ recordId: 0 })],
    ["fractional record id", expense({ recordId: 1.5 })],
    ["string record id", expense({ recordId: "1" })],
    ["impossible date", expense({ date: "2026-02-30" })],
    ["non-date text", expense({ date: "yesterday" })],
    ["numeric amount", expense({ amount: 12.34 })],
    ["one decimal amount", expense({ amount: "12.3" })],
    ["whole amount", expense({ amount: "12" })],
    ["exponent amount", expense({ amount: "1e2" })],
    ["non-string description", expense({ description: 5 })],
    ["null expense category", expense({ category: null })],
    ["paycheck on an expense", expense({ paycheck: { profileId: "x", relation: "recorded_receipt" } })],
    ["category on an inflow", inflow({ category: "food" })],
    ["unknown paycheck relation", inflow({ paycheck: { profileId: "x", relation: "guess" } })],
    ["empty paycheck profile", inflow({ paycheck: { profileId: "", relation: "recorded_receipt" } })],
    ["null item", null],
  ])("fails closed for the whole response on %s", (_name, item) => {
    expect(isActivityTimelinePage(page([expense({ recordId: 9 }), item]))).toBe(false);
  });

  it.each([
    ["another currency", page([], { currencyCode: "EUR" })],
    ["missing items", page(null)],
    ["missing page", { currencyCode: "USD", items: [] }],
    ["limit zero", page([], { page: { limit: 0, hasMore: false, nextCursor: null } })],
    ["limit above the maximum", page([], { page: { limit: 101, hasMore: false, nextCursor: null } })],
    ["string limit", page([], { page: { limit: "25", hasMore: false, nextCursor: null } })],
    ["more without a cursor", page([], { page: { limit: 25, hasMore: true, nextCursor: null } })],
    ["more with an empty cursor", page([], { page: { limit: 25, hasMore: true, nextCursor: "" } })],
    ["a cursor without more", page([], { page: { limit: 25, hasMore: false, nextCursor: "abc" } })],
    ["more rows than the limit", page([expense(), inflow()], { page: { limit: 1, hasMore: false, nextCursor: null } })],
    ["a non-object", "page"],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(isActivityTimelinePage(value)).toBe(false);
  });
});

describe("formatTimelineAmount", () => {
  it("formats exact positive amounts with an explicit direction sign", () => {
    expect(formatTimelineAmount("12.34", "expense", "en-US")).toBe("−$12.34");
    expect(formatTimelineAmount("2500.00", "account_inflow", "en-US")).toBe("+$2,500.00");
    expect(formatTimelineAmount("9999999999999999.99", "expense", "en-US")).toBe("−$9,999,999,999,999,999.99");
    expect(formatTimelineAmount("0.01", "account_inflow", "es-US")).toBe("+$0.01");
  });

  it.each(["0.00", "-5.00", "007.00", "1.5", "10000000000000000.00", 12.34, null])(
    "returns null so the row says the amount needs review: %s", (amount) => {
      expect(formatTimelineAmount(amount, "expense", "en-US")).toBeNull();
    });

  it("returns null for an unknown kind", () => {
    expect(formatTimelineAmount("1.00", "transfer", "en-US")).toBeNull();
  });
});

describe("formatTimelineDate and timelineItemKey", () => {
  it("formats calendar dates without a timezone shift and rejects invalid ones", () => {
    expect(formatTimelineDate("2026-09-22", "en-US")).toBe("Sep 22, 2026");
    expect(formatTimelineDate("2026-02-30", "en-US")).toBeNull();
  });

  it("keys a record by kind and id so an expense and a cash-in with one id stay distinct", () => {
    expect(timelineItemKey(expense({ recordId: 7 }))).not.toBe(timelineItemKey(inflow({ recordId: 7 })));
  });
});
