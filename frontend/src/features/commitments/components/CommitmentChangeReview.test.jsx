import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import groupCommitmentChanges from "../utils/groupCommitmentChanges";
import CommitmentChangeReview from "./CommitmentChangeReview";

const observations = [
  { expenseId: 4, date: "2026-08-17", amount: 25, description: "Gym membership", category: "health", source: "manual" },
  { expenseId: 5, date: "2026-09-17", amount: 25, description: "Gym membership", category: "health", source: "sunflower_pdf" },
  { expenseId: 6, date: "2026-10-17", amount: 25, description: "Gym membership", category: "health", source: "manual" },
];

const changedCommitment = {
  commitment: {
    id: "commitment-1",
    name: "Gym plan",
    category: "health",
    lifecycle: "active",
    cadence: "monthly",
    timingKind: "dayofmonth",
    expectedDayOfWeek: null,
    expectedDay: 15,
    expectedMonth: null,
    windowBeforeDays: 0,
    windowAfterDays: 0,
    amountMode: "fixed",
    expectedAmount: 20,
    expectedMinimumAmount: null,
    expectedMaximumAmount: null,
  },
  algorithmVersion: "commitment-change-v1",
  observations,
  amount: {
    state: "proposed_change",
    fingerprint: "amount-fingerprint",
    decisionState: "pending",
    proposedMode: "fixed",
    proposedAmount: 25,
    proposedMinimumAmount: null,
    proposedMaximumAmount: null,
    observedMedianAmount: 25,
    evidenceExpenseIds: [4, 5],
  },
  timing: {
    state: "proposed_change",
    fingerprint: "timing-fingerprint",
    decisionState: "kept",
    proposedTimingKind: "dayofmonth",
    proposedDayOfWeek: null,
    proposedDay: 17,
    proposedMonth: null,
    proposedWindowBeforeDays: 0,
    proposedWindowAfterDays: 0,
    evidenceExpenseIds: [5, 6],
  },
  missing: { state: "within_expectation", fingerprint: null, decisionState: null, missedSlotAnchors: [] },
};

const missingCommitment = {
  ...changedCommitment,
  commitment: {
    ...changedCommitment.commitment,
    id: "commitment-2",
    name: "Insurance",
    expectedAmount: 80,
    expectedDay: 20,
  },
  observations: [],
  amount: { state: "within_expectation", fingerprint: null, decisionState: null, evidenceExpenseIds: [] },
  timing: { state: "within_expectation", fingerprint: null, decisionState: null, evidenceExpenseIds: [] },
  missing: {
    state: "possibly_ended",
    fingerprint: "missing-fingerprint",
    decisionState: "pending",
    missedSlotAnchors: ["2026-08-20", "2026-09-20", "2026-10-20"],
  },
};

function reviewState(overrides = {}) {
  return {
    commitmentChanges: [changedCommitment, missingCommitment],
    changeEvaluatedOn: "2026-10-29",
    busyKey: null,
    acceptAmountChange: vi.fn().mockResolvedValue(null),
    acceptTimingChange: vi.fn().mockResolvedValue(null),
    markEndedFromChange: vi.fn().mockResolvedValue(null),
    keepChange: vi.fn().mockResolvedValue(null),
    reconsiderChange: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("commitment change review", () => {
  it("groups only actionable exact assessments by pending and kept decision state", () => {
    const pending = groupCommitmentChanges([changedCommitment, missingCommitment], "pending");
    const kept = groupCommitmentChanges([changedCommitment, missingCommitment], "kept");

    expect(pending).toHaveLength(2);
    expect(pending[0].assessments.map((item) => item.dimension)).toEqual(["amount"]);
    expect(pending[1].assessments.map((item) => item.dimension)).toEqual(["missing"]);
    expect(kept).toHaveLength(1);
    expect(kept[0].assessments.map((item) => item.dimension)).toEqual(["timing"]);
  });

  it("renders self-contained pending and kept panels with only their exact evidence", () => {
    render(<CommitmentChangeReview state={reviewState()} />);

    const pendingSection = screen.getByRole("heading", { name: "Changes to review" }).closest("section");
    const keptSection = screen.getByRole("heading", { name: "Kept changes" }).closest("section");
    const pendingGym = within(pendingSection).getByRole("heading", { name: "Gym plan", level: 3 }).closest("article");
    const keptGym = within(keptSection).getByRole("heading", { name: "Gym plan", level: 3 }).closest("article");

    const currentExpectation = within(pendingGym).getByText("Current expectation").closest("div");
    const observedProposal = within(pendingGym).getByText("Observed proposal").closest("div");
    expect(within(currentExpectation).getByText("$20.00")).toBeInTheDocument();
    expect(within(observedProposal).getByText("$25.00")).toBeInTheDocument();
    expect(within(pendingGym).getByText(/Aug 17, 2026/)).toBeInTheDocument();
    expect(within(pendingGym).getByText(/Sep 17, 2026/)).toBeInTheDocument();
    expect(within(pendingGym).queryByText(/Oct 17, 2026/)).not.toBeInTheDocument();
    expect(within(keptGym).queryByText(/Aug 17, 2026/)).not.toBeInTheDocument();
    expect(within(keptGym).getByText(/Sep 17, 2026/)).toBeInTheDocument();
    expect(within(keptGym).getByText(/Oct 17, 2026/)).toBeInTheDocument();
    expect(within(pendingGym).getByText(/Rule version commitment-change-v1/)).toBeInTheDocument();
    expect(screen.getAllByText(/Evaluated Oct 29, 2026/)).toHaveLength(3);
  });

  it("keeps amount and timing actions independent and returns keyboard focus to the destination section", async () => {
    const user = userEvent.setup();
    const state = reviewState();
    render(<CommitmentChangeReview state={state} />);

    await user.click(screen.getByRole("button", { name: "Accept amount change for Gym plan" }));
    expect(state.acceptAmountChange).toHaveBeenCalledWith("commitment-1", "amount-fingerprint");
    expect(state.acceptTimingChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Keep current amount for Gym plan" }));
    expect(state.keepChange).toHaveBeenCalledWith("commitment-1", "amount", "amount-fingerprint");
    expect(screen.getByRole("heading", { name: "Kept changes" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Reconsider timing change for Gym plan" }));
    expect(state.reconsiderChange).toHaveBeenCalledWith("commitment-1", "timing", "timing-fingerprint");
    expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Keep active for Insurance" }));
    expect(state.keepChange).toHaveBeenCalledWith("commitment-2", "missing", "missing-fingerprint");
    expect(screen.getByRole("heading", { name: "Kept changes" })).toHaveFocus();
  });

  it("accepts a timing proposal without changing the amount assessment", async () => {
    const user = userEvent.setup();
    const timingPending = {
      ...changedCommitment,
      amount: { ...changedCommitment.amount, decisionState: "kept" },
      timing: { ...changedCommitment.timing, decisionState: "pending" },
    };
    const state = reviewState({ commitmentChanges: [timingPending] });
    render(<CommitmentChangeReview state={state} />);

    await user.click(screen.getByRole("button", { name: "Accept timing change for Gym plan" }));

    expect(state.acceptTimingChange).toHaveBeenCalledWith("commitment-1", "timing-fingerprint");
    expect(state.acceptAmountChange).not.toHaveBeenCalled();
  });

  it("requires an inline accessible confirmation before marking a commitment ended", async () => {
    const user = userEvent.setup();
    const state = reviewState();
    render(<CommitmentChangeReview state={state} />);

    await user.click(screen.getByRole("button", { name: "Mark Insurance ended" }));
    const confirmation = screen.getByRole("group", { name: /Mark Insurance ended/ });
    const confirmButton = within(confirmation).getByRole("button", { name: "Confirm mark Insurance ended" });
    expect(confirmation).toHaveTextContent("you can change it again");
    expect(confirmButton).toHaveFocus();
    expect(state.markEndedFromChange).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "Cancel marking Insurance ended" }));
    const markEndedButton = screen.getByRole("button", { name: "Mark Insurance ended" });
    expect(markEndedButton).toHaveFocus();

    await user.click(markEndedButton);
    await user.click(screen.getByRole("button", { name: "Confirm mark Insurance ended" }));

    expect(state.markEndedFromChange).toHaveBeenCalledWith("commitment-2", "missing-fingerprint");
    expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus();
  });

  it("shows empty states and disables every decision while an action is busy", () => {
    const { rerender } = render(<CommitmentChangeReview state={reviewState({ commitmentChanges: [] })} />);
    expect(screen.getByText("No commitment changes need your review.")).toBeInTheDocument();
    expect(screen.getByText("No kept changes.")).toBeInTheDocument();

    rerender(<CommitmentChangeReview state={reviewState({ busyKey: "change:amount:accept" })} />);
    expect(screen.getAllByRole("button")).not.toHaveLength(0);
    expect(screen.getAllByRole("button").every((button) => button.disabled)).toBe(true);
  });
});
