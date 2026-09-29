import { describe, expect, it } from "vitest";
import { formatHomeAmount, formatHomeDate, formatHomeProjectionAmount, isHomeAttentionSection, isHomeResponse, isHomeUpcomingSection } from "./homePresentation";

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
  attention: {
    availability: { state: "available", reasonCode: null },
    kindsEvaluated: ["commitment_change_review", "budget_attention"],
    items: [], budgetItems: [],
    familyAvailability: {
      commitment_change_review: { state: "available", reasonCode: null },
      budget_attention: { state: "available", reasonCode: null },
    },
    evaluatedOn: "2026-09-23",
  },
  recentActivity: { availability: { state: "available", reasonCode: null }, items: [item] },
  upcoming: { availability: { state: "available", reasonCode: null }, horizon: { from: "2026-09-23", through: "2026-10-06" }, items: [] },
};

const projection = (overrides = {}) => ({
  kind: "paycheck_projection",
  paycheckProfileId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
  displayName: "Primary paycheck",
  cadence: "biweekly",
  anchorDate: "2026-10-01",
  earliestExpectedDate: "2026-09-30",
  latestExpectedDate: "2026-10-02",
  amount: { mode: "fixed", fixedAmount: "9999999999999999.99", minimumAmount: null, maximumAmount: null },
  ...overrides,
});

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

  it("requires a truthful attention evaluation envelope and actionable structured items", () => {
    const item = {
      kind: "commitment_change_review",
      commitmentId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
      commitmentName: "Gym plan",
      reviews: [{ dimension: "amount", state: "proposed_change" }],
    };
    expect(isHomeAttentionSection({ ...response.attention, items: [item] }, "2026-09-23")).toBe(true);
    expect(isHomeAttentionSection({ ...response.attention, kindsEvaluated: [], items: [] }, "2026-09-23")).toBe(false);
    expect(isHomeAttentionSection({ ...response.attention, items: [{ ...item, reviews: [{ dimension: "amount", state: "possible_change" }] }] }, "2026-09-23")).toBe(false);
    expect(isHomeAttentionSection({
      availability: { state: "unavailable", reasonCode: "source_unavailable" },
      kindsEvaluated: [], items: null, budgetItems: null,
      familyAvailability: {
        commitment_change_review: { state: "unavailable", reasonCode: "source_unavailable" },
        budget_attention: { state: "unavailable", reasonCode: "source_unavailable" },
      },
      evaluatedOn: "2026-09-23",
    }, "2026-09-23")).toBe(true);
  });

  it("distinguishes quiet and unavailable attention families in every combination", () => {
    const budgetItem = {
      kind: "budget_attention", category: "food", state: "over_limit",
      spentAmount: "101.25", limitAmount: "100.00",
    };
    const commitmentItem = {
      kind: "commitment_change_review",
      commitmentId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
      commitmentName: "Gym plan", reviews: [{ dimension: "amount", state: "proposed_change" }],
    };
    const attention = (commitmentState, budgetState, items, budgetItems) => {
      const anyAvailable = commitmentState === "available" || budgetState === "available";
      const kindsEvaluated = [
        ...(commitmentState === "available" ? ["commitment_change_review"] : []),
        ...(budgetState === "available" ? ["budget_attention"] : []),
      ];
      return {
        ...response.attention,
        availability: { state: anyAvailable ? "available" : "unavailable", reasonCode: anyAvailable ? null : "source_unavailable" },
        kindsEvaluated, items, budgetItems,
        familyAvailability: {
          commitment_change_review: { state: commitmentState, reasonCode: commitmentState === "available" ? null : "source_unavailable" },
          budget_attention: { state: budgetState, reasonCode: budgetState === "available" ? null : "source_unavailable" },
        },
      };
    };

    expect(isHomeAttentionSection(attention("available", "available", [commitmentItem], [budgetItem]), "2026-09-23")).toBe(true);
    expect(isHomeAttentionSection(attention("available", "unavailable", [commitmentItem], null), "2026-09-23")).toBe(true);
    expect(isHomeAttentionSection(attention("unavailable", "available", null, [budgetItem]), "2026-09-23")).toBe(true);
    expect(isHomeAttentionSection(attention("unavailable", "unavailable", null, null), "2026-09-23")).toBe(true);
    expect(isHomeAttentionSection(attention("available", "unavailable", [], []), "2026-09-23")).toBe(false);
  });

  it("accepts the approved mixed ranking contract", () => {
    const mixed = {
      ...response.attention,
      items: ["a", "b", "c"].map((id, index) => ({
        kind: "commitment_change_review",
        commitmentId: `c375a2a2-3f95-43b0-985e-a9360237b0${id}7`,
        commitmentName: `Commitment ${index + 1}`,
        reviews: [{ dimension: "amount", state: "proposed_change" }],
      })),
      budgetItems: [
        { kind: "budget_attention", category: "Groceries", state: "over_limit", spentAmount: "110.00", limitAmount: "100.00" },
        { kind: "budget_attention", category: "Food", state: "at_limit", spentAmount: "50.00", limitAmount: "50.00" },
      ],
    };
    expect(isHomeAttentionSection(mixed, "2026-09-23")).toBe(true);
  });

  it("fails closed for malformed budget states, exact amounts, and ranking", () => {
    const budgetItem = {
      kind: "budget_attention", category: "food", state: "over_limit",
      spentAmount: "101.25", limitAmount: "100.00",
    };
    const invalid = [
      { ...budgetItem, state: "near_limit" },
      { ...budgetItem, spentAmount: "100.00" },
      { ...budgetItem, spentAmount: "1.001" },
      { ...budgetItem, limitAmount: "0.00" },
      { ...budgetItem, kind: "commitment_change_review" },
    ];
    for (const item of invalid) {
      expect(isHomeAttentionSection({ ...response.attention, budgetItems: [item] }, "2026-09-23")).toBe(false);
    }
    expect(isHomeAttentionSection({
      ...response.attention,
      budgetItems: [
        { ...budgetItem, category: "food", spentAmount: "101.00" },
        { ...budgetItem, category: "rent", spentAmount: "102.00" },
      ],
    }, "2026-09-23")).toBe(false);
  });

  it("keeps legacy or malformed attention data out of whole-Home response validation", () => {
    const legacyAttention = {
      availability: { state: "available", reasonCode: null },
      kindsEvaluated: [],
      items: [],
    };
    expect(isHomeResponse({ ...response, attention: legacyAttention })).toBe(true);
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

  it("validates the exact Upcoming contract and accepts overlapping projection windows", () => {
    const first = projection();
    const second = projection({
      paycheckProfileId: "c375a2a2-3f95-43b0-985e-a9360237b0b7",
      displayName: "Second paycheck",
      cadence: "monthly",
      anchorDate: "2026-10-07",
      earliestExpectedDate: "2026-10-05",
      latestExpectedDate: "2026-10-08",
      amount: { mode: "range", fixedAmount: null, minimumAmount: "1.00", maximumAmount: "1.01" },
    });
    expect(isHomeUpcomingSection({ ...response.upcoming, items: [first, second] }, "2026-09-23")).toBe(true);
    expect(isHomeUpcomingSection({ ...response.upcoming, items: [first, second, projection()] }, "2026-09-23")).toBe(false);
    expect(isHomeUpcomingSection({ ...response.upcoming, availability: { state: "unavailable", reasonCode: "source_unavailable" }, items: null }, "2026-09-23")).toBe(true);
  });

  it("fails closed for malformed Upcoming cadence, amount, date, identity, and horizon values", () => {
    const invalid = [
      projection({ cadence: "quarterly" }),
      projection({ displayName: "  " }),
      projection({ paycheckProfileId: "not-a-guid" }),
      projection({ paycheckProfileId: "00000000-0000-0000-0000-000000000000" }),
      projection({ earliestExpectedDate: "2026-10-02" }),
      projection({ earliestExpectedDate: "2026-10-07", anchorDate: "2026-10-08", latestExpectedDate: "2026-10-09" }),
      projection({ amount: { mode: "fixed", fixedAmount: "10000000000000000.00", minimumAmount: null, maximumAmount: null } }),
      projection({ amount: { mode: "fixed", fixedAmount: "1.0", minimumAmount: null, maximumAmount: null } }),
      projection({ amount: { mode: "range", fixedAmount: null, minimumAmount: "2.00", maximumAmount: "2.00" } }),
    ];
    for (const item of invalid) {
      expect(isHomeUpcomingSection({ ...response.upcoming, items: [item] }, "2026-09-23")).toBe(false);
    }
    expect(isHomeUpcomingSection({ ...response.upcoming, horizon: { from: "2026-09-23", through: "2026-10-07" } }, "2026-09-23")).toBe(false);
    expect(isHomeUpcomingSection({ ...response.upcoming, items: [projection({
      earliestExpectedDate: "2026-10-07", anchorDate: "2026-10-08", latestExpectedDate: "2026-10-09",
    })] }, "2026-09-23")).toBe(false);
  });

  it("formats exact projection values in USD without adding an actual-inflow sign", () => {
    expect(formatHomeProjectionAmount("9999999999999999.99", "en-US"))
      .toBe("$9,999,999,999,999,999.99");
    expect(formatHomeProjectionAmount("1234.56", "es-US")).toBe("$1,234.56");
    expect(formatHomeProjectionAmount("10000000000000000.00", "en-US")).toBeNull();
  });
});
