import { describe, expect, it } from "vitest";
import { makePaycheck } from "../test/paycheckFixtures";
import { computeSuggestions, suggestionKey } from "./paycheckSuggestions";

const dep = (id, date, amount, extra = {}) => ({ id, description: `Deposit ${id}`, date, amount, ...extra });
const unlinked = (overrides = {}) => makePaycheck({ evidence: [], ...overrides });
const range = (minimumAmount, maximumAmount) => ({ mode: "range", fixedAmount: null, minimumAmount, maximumAmount });
const ids = (result) => result.map((row) => row.inflow.id);

describe("computeSuggestions", () => {
  it("suggests a fixed amount deposit inside the window and exposes the dismissal key", () => {
    const result = computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks: [unlinked()] });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe(suggestionKey(result[0].profile.id, "2026-08-10", 1));
    expect(result[0].slot.anchor).toBe("2026-08-10");
  });

  it("requires exact cents for fixed amounts", () => {
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500.01)], paychecks: [unlinked()] })).toEqual([]);
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2499.99)], paychecks: [unlinked()] })).toEqual([]);
  });

  it("treats range bounds as inclusive and rejects outside values", () => {
    const paycheck = unlinked({ amount: range("2000.00", "3000.00") });
    for (const [amount, expected] of [[2000, 1], [3000, 1], [2500, 1], [1999.99, 0], [3000.01, 0]])
      expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", amount)], paychecks: [paycheck] })).toHaveLength(expected);
  });

  it("compares dates inclusively as plain calendar strings", () => {
    const paychecks = [unlinked()];
    for (const [date, expected] of [["2026-08-09", 1], ["2026-08-11", 1], ["2026-08-08", 0], ["2026-08-12", 0]])
      expect(computeSuggestions({ inflows: [dep(1, date, 2500)], paychecks })).toHaveLength(expected);
  });

  it("ignores paused and ended schedules and schedules without open slots", () => {
    const inflows = [dep(1, "2026-08-10", 2500)];
    for (const overrides of [{ lifecycle: "paused" }, { lifecycle: "ended" }, { receiptSlots: [] }, { receiptSlots: undefined }])
      expect(computeSuggestions({ inflows, paychecks: [unlinked(overrides)] })).toEqual([]);
  });

  it("excludes deposits already linked to any schedule, including paused or ended ones", () => {
    const active = unlinked();
    for (const lifecycle of ["active", "paused", "ended"]) {
      const holder = makePaycheck({ id: "other", lifecycle, receiptSlots: [], evidence: [{ accountInflowId: 1, assignmentKind: "receipt" }] });
      expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks: [active, holder] })).toEqual([]);
    }
  });

  it("yields nothing for an occupied slot because the backend omits it from receiptSlots", () => {
    const occupied = unlinked({ receiptSlots: [{ relation: "previous", anchor: "2026-07-10", earliestExpectedDate: "2026-07-09", latestExpectedDate: "2026-07-11" }] });
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks: [occupied] })).toEqual([]);
  });

  it("suppresses both identical deposits when they fit one slot", () => {
    const inflows = [dep(1, "2026-08-10", 2500), dep(2, "2026-08-10", 2500)];
    expect(computeSuggestions({ inflows, paychecks: [unlinked()] })).toEqual([]);
  });

  it("suppresses a deposit that fits two schedules", () => {
    const paychecks = [unlinked({ id: "a" }), unlinked({ id: "b" })];
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks })).toEqual([]);
  });

  it("handles the current and previous slot of one schedule independently", () => {
    const inflows = [dep(1, "2026-08-10", 2500), dep(2, "2026-07-10", 2500)];
    const result = computeSuggestions({ inflows, paychecks: [unlinked()] });
    expect(ids(result)).toEqual([1, 2]);
    expect(result.map((row) => row.slot.relation)).toEqual(["current", "previous"]);
  });

  it("suppresses one deposit that fits both slots of a schedule", () => {
    const wide = unlinked({ receiptSlots: [
      { relation: "current", anchor: "2026-08-10", earliestExpectedDate: "2026-07-01", latestExpectedDate: "2026-08-31" },
      { relation: "previous", anchor: "2026-07-10", earliestExpectedDate: "2026-07-01", latestExpectedDate: "2026-08-31" },
    ] });
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks: [wide] })).toEqual([]);
  });

  it("fails closed on unsafe amounts, bad dates and unparseable values", () => {
    const inflows = [
      dep(1, "2026-08-10", 2 ** 46), dep(2, "2026-02-30", 2500), dep(3, "2026-08-10", "abc"),
      dep(4, "2026-08-10", -2500), dep(5, "2026-08-10", null), dep(6, undefined, 2500),
    ];
    expect(computeSuggestions({ inflows, paychecks: [unlinked({ amount: range("0.01", "99999999999999") })] })).toEqual([]);
  });

  it("does not match when the expected amount cannot be parsed", () => {
    const inflows = [dep(1, "2026-08-10", 2500)];
    const fixed = { mode: "fixed", fixedAmount: 2 ** 46, minimumAmount: null, maximumAmount: null };
    for (const amount of [fixed, range("x", "3000"), range("2000", null), { mode: "other" }, undefined])
      expect(computeSuggestions({ inflows, paychecks: [unlinked({ amount })] })).toEqual([]);
  });

  it("agrees with the Link panel for API numbers against decimal strings", () => {
    const paycheck = unlinked({ amount: { mode: "fixed", fixedAmount: "1234.50", minimumAmount: null, maximumAmount: null } });
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 1234.5)], paychecks: [paycheck] })).toHaveLength(1);
  });

  it("orders by deposit date descending and then id descending", () => {
    const slot = (anchor) => [{ relation: "current", anchor, earliestExpectedDate: "2026-08-01", latestExpectedDate: "2026-08-31" }];
    const paychecks = [
      unlinked({ id: "a", amount: range("10", "20"), receiptSlots: slot("2026-08-10") }),
      unlinked({ id: "b", amount: range("30", "40"), receiptSlots: slot("2026-08-20") }),
      unlinked({ id: "c", amount: range("50", "60"), receiptSlots: slot("2026-08-25") }),
    ];
    const inflows = [dep(2, "2026-08-07", 15), dep(9, "2026-08-07", 35), dep(1, "2026-08-20", 55)];
    expect(ids(computeSuggestions({ inflows, paychecks }))).toEqual([1, 9, 2]);
    expect(ids(computeSuggestions({ inflows: [...inflows].reverse(), paychecks }))).toEqual([1, 9, 2]);
  });

  it("returns an empty list for empty or missing input", () => {
    expect(computeSuggestions({ inflows: [], paychecks: [unlinked()] })).toEqual([]);
    expect(computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500)], paychecks: [] })).toEqual([]);
    expect(computeSuggestions({})).toEqual([]);
    expect(computeSuggestions()).toEqual([]);
  });

  it("never reads the description", () => {
    const result = computeSuggestions({ inflows: [dep(1, "2026-08-10", 2500, { description: "Coffee shop" })], paychecks: [unlinked()] });
    expect(result).toHaveLength(1);
  });
});
