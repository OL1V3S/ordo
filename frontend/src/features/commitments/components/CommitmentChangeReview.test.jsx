import { act, render, screen, waitFor, within } from "@testing-library/react";
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

const reviewedHeading = () => screen.getByRole("heading", { level: 2, name: /Reviewed changes \(\d+\)/ });
const reviewedHistory = () => reviewedHeading().closest("details");

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

  it("keeps decision facts visible and exact evidence and mechanics in named details", async () => {
    const user = userEvent.setup();
    render(<CommitmentChangeReview state={reviewState()} />);

    const pendingSection = screen.getByRole("heading", { name: "Changes to review" }).closest("section");
    const pendingGym = within(pendingSection).getByRole("heading", { name: "Gym plan", level: 3 }).closest("article");

    const currentExpectation = within(pendingGym).getByText("Current expectation").closest("div");
    const observedProposal = within(pendingGym).getByText("Observed change").closest("div");
    expect(within(currentExpectation).getByText("$20.00")).toBeVisible();
    expect(within(observedProposal).getByText("$25.00")).toBeVisible();
    expect(within(pendingGym).getByText("2 recent expenses support this amount change.")).toBeVisible();
    expect(within(pendingGym).getByText("Pending")).toBeVisible();
    const amountDetails = within(pendingGym).getByLabelText("Details for amount change for Gym plan").closest("details");
    expect(amountDetails).not.toHaveAttribute("open");
    expect(within(pendingGym).getByText(/Aug 17, 2026/)).not.toBeVisible();
    await user.click(within(pendingGym).getByLabelText("Details for amount change for Gym plan"));
    expect(amountDetails).toHaveAttribute("open");
    expect(within(pendingGym).getByText(/Aug 17, 2026/)).toBeVisible();
    expect(within(pendingGym).getByText(/Sep 17, 2026/)).toBeVisible();
    expect(within(pendingGym).queryByText(/Oct 17, 2026/)).not.toBeInTheDocument();
    expect(within(amountDetails).getByText("Evaluated").closest("div")).toHaveTextContent("Oct 29, 2026");
    expect(within(amountDetails).getByText("Detection details").closest("div")).toHaveTextContent("commitment-change-v1");

    expect(reviewedHeading()).toHaveAccessibleName("Reviewed changes (1)");
    expect(reviewedHistory()).not.toHaveAttribute("open");
    await user.click(reviewedHeading().closest("summary"));
    const keptGym = within(reviewedHistory()).getByRole("heading", { name: "Gym plan", level: 3 }).closest("article");
    expect(within(keptGym).getByText("Reviewed change")).toBeVisible();
    expect(within(keptGym).getByText("Health · Monthly")).toBeVisible();
    const timingDetails = within(keptGym).getByLabelText("Details for timing change for Gym plan").closest("details");
    expect(timingDetails).not.toHaveAttribute("open");
    await user.click(within(keptGym).getByLabelText("Details for timing change for Gym plan"));
    expect(within(keptGym).queryByText(/Aug 17, 2026/)).not.toBeInTheDocument();
    expect(within(keptGym).getByText(/Sep 17, 2026/)).toBeVisible();
    expect(within(keptGym).getByText(/Oct 17, 2026/)).toBeVisible();

    const insurance = within(pendingSection).getByRole("heading", { name: "Insurance", level: 3 }).closest("article");
    expect(within(insurance).getByText("Possibly ended")).toBeVisible();
    expect(within(insurance).getByText("This is an observation, not an automatic status change.")).toBeVisible();
    expect(within(insurance).getByText("3 expected monthly dates have passed without a matching expense.")).toBeVisible();
    expect(within(insurance).getByText("Aug 20, 2026")).toBeVisible();
  });

  it("keeps amount and timing actions independent and returns keyboard focus to the destination section", async () => {
    const user = userEvent.setup();
    const state = reviewState();
    render(<CommitmentChangeReview state={state} />);

    await user.click(screen.getByRole("button", { name: "Accept amount change for Gym plan" }));
    expect(state.acceptAmountChange).toHaveBeenCalledWith("commitment-1", "amount-fingerprint");
    expect(state.acceptTimingChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Keep current amount for Gym plan" }));
    expect(state.keepChange).toHaveBeenCalledWith("commitment-1", "amount", "amount-fingerprint");
    expect(reviewedHistory()).toHaveAttribute("open");
    await waitFor(() => expect(reviewedHeading().closest("summary")).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Reconsider timing change for Gym plan" }));
    expect(state.reconsiderChange).toHaveBeenCalledWith("commitment-1", "timing", "timing-fingerprint");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Keep active for Insurance" }));
    expect(state.keepChange).toHaveBeenCalledWith("commitment-2", "missing", "missing-fingerprint");
    await waitFor(() => expect(reviewedHeading().closest("summary")).toHaveFocus());
  });

  it("does not let delayed destination focus steal a newly opened end confirmation", async () => {
    const user = userEvent.setup();
    const frames = [];
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    try {
      const feedback = document.createElement("div");
      feedback.id = "commitments-feedback";
      feedback.tabIndex = -1;
      feedback.innerHTML = '<p role="alert">Decision failed.</p>';
      document.body.append(feedback);
      render(<CommitmentChangeReview state={reviewState()} />);

      await user.click(screen.getByRole("button", { name: "Accept amount change for Gym plan" }));
      await user.click(screen.getByRole("button", { name: "Mark Insurance ended" }));
      const confirmation = screen.getByRole("button", { name: "Confirm mark Insurance ended" });
      expect(confirmation).toHaveFocus();
      act(() => frames.splice(0).forEach((callback) => callback(performance.now())));
      expect(confirmation).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Cancel marking Insurance ended" }));
      await user.click(screen.getByRole("button", { name: "Accept amount change for Gym plan" }));
      act(() => frames.splice(0).forEach((callback) => callback(performance.now())));
      expect(feedback).toHaveFocus();
      feedback.remove();
    } finally {
      animationFrame.mockRestore();
      document.getElementById("commitments-feedback")?.remove();
    }
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

  it("shows exact high-value derived amounts and fails closed for ambiguous legacy amount evidence", () => {
    const high = "9999999999999999.99";
    const exactChange = {
      ...changedCommitment,
      observations: observations.map((observation) => ({ ...observation, amount: high })),
      amount: { ...changedCommitment.amount, proposedAmount: high, observedMedianAmount: high },
    };
    const { rerender } = render(<CommitmentChangeReview state={reviewState({ commitmentChanges: [exactChange] })} />);
    expect(screen.getAllByText("$9,999,999,999,999,999.99").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Accept amount change for Gym plan" })).toBeEnabled();

    const ambiguous = {
      ...exactChange,
      observations: [{ ...observations[0], amount: Number("9999999999999999") }],
    };
    rerender(<CommitmentChangeReview state={reviewState({ commitmentChanges: [ambiguous] })} />);
    expect(screen.getByText(/Exact amount review is unavailable/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept amount change for Gym plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep current amount for Gym plan" })).toBeDisabled();
  });

  it("requires an inline accessible confirmation before marking a commitment ended", async () => {
    const user = userEvent.setup();
    const state = reviewState();
    const renderReview = (review) => (
      <>
        <div id="commitments-feedback" tabIndex={-1}>
          {review.loadError && <p role="alert">{review.loadError}</p>}
        </div>
        <CommitmentChangeReview state={review} />
      </>
    );
    const { rerender } = render(renderReview(state));

    await user.click(screen.getByRole("button", { name: "Mark Insurance ended" }));
    const confirmation = screen.getByRole("group", { name: /Mark Insurance ended/ });
    const confirmButton = within(confirmation).getByRole("button", { name: "Confirm mark Insurance ended" });
    const missingDetails = screen.getByLabelText("Details for missing change for Insurance").closest("details");
    expect(confirmation).toHaveTextContent("you can change it again");
    expect(confirmButton).toHaveFocus();
    expect(missingDetails).not.toContainElement(confirmation);
    expect(state.markEndedFromChange).not.toHaveBeenCalled();

    const loadErrorState = reviewState({ loadError: "Commitments could not be loaded." });
    rerender(renderReview(loadErrorState));
    expect(screen.getByRole("button", { name: "Confirm mark Insurance ended" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel marking Insurance ended" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel marking Insurance ended" }));
    expect(document.getElementById("commitments-feedback")).toHaveFocus();

    rerender(renderReview(state));
    await user.click(screen.getByRole("button", { name: "Mark Insurance ended" }));
    await user.click(screen.getByRole("button", { name: "Cancel marking Insurance ended" }));
    const markEndedButton = screen.getByRole("button", { name: "Mark Insurance ended" });
    expect(markEndedButton).toHaveFocus();

    await user.click(markEndedButton);
    await user.click(screen.getByRole("button", { name: "Confirm mark Insurance ended" }));

    expect(state.markEndedFromChange).toHaveBeenCalledWith("commitment-2", "missing-fingerprint");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Changes to review" })).toHaveFocus());
    expect(screen.getByRole("group", { name: /Mark Insurance ended/ })).toBeInTheDocument();
  });

  it("supports split pending and reviewed views and reports reviewed disclosure changes", async () => {
    const user = userEvent.setup();
    const state = reviewState();
    const onReviewedOpenChange = vi.fn();
    const { rerender } = render(
      <CommitmentChangeReview state={state} view="pending" activeTask={null} onTaskChange={vi.fn()}
        reviewedOpen={false} onReviewedOpenChange={onReviewedOpenChange} />
    );
    expect(screen.getByRole("heading", { name: "Changes to review" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reviewed changes/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep current amount for Gym plan" }));
    expect(onReviewedOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <CommitmentChangeReview state={state} view="reviewed" activeTask={null} onTaskChange={vi.fn()}
        reviewedOpen={false} onReviewedOpenChange={onReviewedOpenChange} />
    );
    expect(screen.queryByRole("heading", { name: "Changes to review" })).not.toBeInTheDocument();
    expect(reviewedHeading()).toHaveAccessibleName("Reviewed changes (1)");
    expect(reviewedHistory()).not.toHaveAttribute("open");
  });

  it("locks reviewed history open while reconsidering", async () => {
    const user = userEvent.setup();
    render(<CommitmentChangeReview view="reviewed" state={reviewState({ busyKey: "change:timing:reconsider:commitment-1:timing-fingerprint" })} />);
    const summary = reviewedHeading().closest("summary");
    expect(reviewedHistory()).toHaveAttribute("open");
    expect(summary).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Reconsider timing change for Gym plan" })).toBeDisabled();
    await user.click(summary);
    expect(reviewedHistory()).toHaveAttribute("open");
  });

  it("clears only its exact End task when the pending assessment disappears", async () => {
    const endTask = { mode: "change-end", key: "commitment-2:missing-fingerprint" };
    const onTaskChange = vi.fn();
    const { rerender } = render(
      <CommitmentChangeReview state={reviewState()} view="pending" activeTask={endTask} onTaskChange={onTaskChange} />
    );
    expect(screen.getByRole("group", { name: /Mark Insurance ended/ })).toBeInTheDocument();

    rerender(<CommitmentChangeReview state={reviewState({ loadError: "Refresh failed." })} view="pending" activeTask={endTask} onTaskChange={onTaskChange} />);
    expect(screen.getByRole("group", { name: /Mark Insurance ended/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm mark Insurance ended" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel marking Insurance ended" })).toBeEnabled();
    expect(onTaskChange).not.toHaveBeenCalled();

    rerender(<CommitmentChangeReview state={reviewState({ commitmentChanges: [changedCommitment] })} view="pending" activeTask={endTask} onTaskChange={onTaskChange} />);
    await waitFor(() => expect(onTaskChange).toHaveBeenCalledExactlyOnceWith(null));

    onTaskChange.mockClear();
    rerender(<CommitmentChangeReview state={reviewState({ commitmentChanges: [changedCommitment] })} view="reviewed" activeTask={endTask} onTaskChange={onTaskChange} />);
    expect(onTaskChange).not.toHaveBeenCalled();

    const editTask = { mode: "edit", key: "commitment-2" };
    rerender(<CommitmentChangeReview state={reviewState()} view="pending" activeTask={editTask} onTaskChange={onTaskChange} />);
    expect(screen.getByRole("button", { name: "Accept amount change for Gym plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep active for Insurance" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark Insurance ended" })).toBeDisabled();
    expect(onTaskChange).not.toHaveBeenCalled();
  });

  it("shows empty states and disables every decision while an action is busy", () => {
    const { rerender } = render(<CommitmentChangeReview state={reviewState({ commitmentChanges: [] })} />);
    expect(screen.getByText("No commitment changes need your review.")).toBeInTheDocument();
    expect(screen.getByText("No reviewed changes.")).toBeInTheDocument();
    expect(reviewedHeading()).toHaveAccessibleName("Reviewed changes (0)");
    expect(reviewedHistory()).not.toHaveAttribute("open");

    rerender(<CommitmentChangeReview state={reviewState({ busyKey: "change:amount:accept" })} />);
    expect(screen.getAllByRole("button")).not.toHaveLength(0);
    expect(screen.getAllByRole("button").every((button) => button.disabled)).toBe(true);
  });
});
