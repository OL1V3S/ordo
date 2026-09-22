import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommitments } from "../hooks/useCommitments";
import CommitmentsPage from "./CommitmentsPage";

vi.mock("../hooks/useCommitments", () => ({ useCommitments: vi.fn() }));

const evidence = [
  { expenseId: 1, date: "2026-05-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
  { expenseId: 2, date: "2026-06-15", amount: 20, description: "Gym membership", category: "health", source: "sunflower_pdf" },
  { expenseId: 3, date: "2026-07-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
];

const candidate = {
  fingerprint: "fingerprint-1", algorithmVersion: "commitment-v1", description: "Gym membership", category: "health",
  cadence: "monthly", timingKind: "dayofmonth", expectedDayOfWeek: null, expectedDay: 15, expectedMonth: null,
  windowBeforeDays: 0, windowAfterDays: 0, observedAmountMode: "fixed", observedMedianAmount: 20,
  observedMinimumAmount: 20, observedMaximumAmount: 20, coveredFrom: "2026-05-15", coveredTo: "2026-07-15",
  occurrenceCount: 3, evidenceRule: "consecutive_calendar_months", evidence,
};

const dismissedCandidate = {
  ...candidate, fingerprint: "fingerprint-2", description: "Streaming service",
  evidence: evidence.map((item) => ({ ...item, description: "Streaming service" })),
};

const commitment = {
  id: "commitment-1", name: "Rent", category: "housing", lifecycle: "active", cadence: "monthly",
  timingKind: "dayofmonth", expectedDayOfWeek: null, expectedDay: 1, expectedMonth: null,
  windowBeforeDays: 1, windowAfterDays: 1, amountMode: "fixed", expectedAmount: 1200,
  expectedMinimumAmount: null, expectedMaximumAmount: null,
  evidence: evidence.map((item) => ({ ...item, description: "Rent", amount: 1200, category: "housing" })),
};

const commitmentChange = {
  commitment: { ...commitment, name: "Gym plan", expectedAmount: 20, expectedDay: 15 },
  algorithmVersion: "commitment-change-v1", observations: evidence,
  amount: {
    state: "proposed_change", fingerprint: "amount-fingerprint", decisionState: "pending",
    proposedMode: "fixed", proposedAmount: 25, proposedMinimumAmount: null, proposedMaximumAmount: null,
    evidenceExpenseIds: [1, 2],
  },
  timing: {
    state: "proposed_change", fingerprint: "timing-fingerprint", decisionState: "kept",
    proposedTimingKind: "dayofmonth", proposedDayOfWeek: null, proposedDay: 17, proposedMonth: null,
    proposedWindowBeforeDays: 0, proposedWindowAfterDays: 0, evidenceExpenseIds: [2, 3],
  },
  missing: { state: "within_expectation", fingerprint: null, decisionState: null, missedSlotAnchors: [] },
};

function state(overrides = {}) {
  return {
    candidates: [candidate], dismissedCandidates: [dismissedCandidate], commitments: [commitment], commitmentChanges: [],
    changeEvaluatedOn: "2026-10-29", loading: false, loadError: null, actionError: null, notice: null, busyKey: null,
    refresh: vi.fn(), clearMessages: vi.fn(), dismissCandidate: vi.fn().mockResolvedValue(null),
    reconsiderCandidate: vi.fn().mockResolvedValue(null), confirmCandidate: vi.fn().mockResolvedValue({ alreadyConfirmed: false }),
    updateCommitment: vi.fn().mockResolvedValue({ id: commitment.id }), updateLifecycle: vi.fn().mockResolvedValue({ id: commitment.id }),
    acceptAmountChange: vi.fn().mockResolvedValue(null), acceptTimingChange: vi.fn().mockResolvedValue(null),
    markEndedFromChange: vi.fn().mockResolvedValue(null), keepChange: vi.fn().mockResolvedValue(null),
    reconsiderChange: vi.fn().mockResolvedValue(null), ...overrides,
  };
}

const card = (name) => screen.getByRole("heading", { name, exact: true }).closest("article");
const disclosure = (name) => screen.getByLabelText(`Details for ${name}`).closest("details");
const historyHeading = (name) => screen.getByRole("heading", { level: 2, name: new RegExp(`^${name} \\(\\d+\\)$`) });
const history = (name) => historyHeading(name).closest("details");

beforeEach(() => useCommitments.mockReturnValue(state()));
afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("Commitments workspace", () => {
  it("puts active saved commitments and decision work before closed history while preserving every disclosure", async () => {
    const user = userEvent.setup();
    const paused = { ...commitment, id: "commitment-2", name: "Paused rent", lifecycle: "paused" };
    const ended = { ...commitment, id: "commitment-3", name: "Ended rent", lifecycle: "ended" };
    useCommitments.mockReturnValue(state({ commitments: [commitment, paused, ended], commitmentChanges: [commitmentChange] }));
    render(<CommitmentsPage />);

    const headings = [
      screen.getByRole("heading", { level: 2, name: "Your commitments" }),
      screen.getByRole("heading", { level: 2, name: "Changes to review" }),
      screen.getByRole("heading", { level: 2, name: "Possible commitments" }),
      historyHeading("Paused commitments"), historyHeading("Ended commitments"), historyHeading("Reviewed changes"),
      historyHeading("Dismissed possible commitments"),
    ];
    for (let index = 0; index < headings.length - 1; index += 1) {
      expect(headings[index].compareDocumentPosition(headings[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const saved = within(card("Rent"));
    expect(saved.getByText("Active")).toBeVisible();
    expect(saved.getByText("Expected amount")).toBeVisible();
    expect(saved.getAllByText("$1,200.00")[0]).toBeVisible();
    expect(saved.getByText("Housing · Monthly")).toBeVisible();
    expect(saved.getByText("Day 1, with a 1-day before / 1-day after window")).toBeVisible();
    expect(saved.getByRole("button", { name: "Edit Rent" })).toBeVisible();
    expect(saved.getByRole("button", { name: "Pause Rent" })).toBeVisible();
    expect(saved.getByText("Records used to confirm", { selector: "h4" })).not.toBeVisible();
    expect(disclosure("Rent")).not.toHaveAttribute("open");
    await user.click(saved.getByLabelText("Details for Rent"));
    expect(saved.getByText("3 linked expense(s)")).toBeVisible();
    expect(saved.getByText("Records used to confirm", { selector: "h4" })).toBeVisible();
    expect(saved.getByText("Sunflower statement")).toBeVisible();
    expect(saved.getByText("May 15, 2026 · Housing")).toBeVisible();
    expect(saved.queryByText(/revision/i)).not.toBeInTheDocument();

    const possible = within(card("Gym membership"));
    expect(possible.getAllByText("Observed amount")[0]).toBeVisible();
    expect(possible.getAllByText("$20.00")[0]).toBeVisible();
    expect(possible.getByText("Based on 3 expenses")).toBeVisible();
    expect(possible.getByText("commitment-v1")).not.toBeVisible();
    expect(disclosure("Gym membership")).not.toHaveAttribute("open");
    await user.click(possible.getByLabelText("Details for Gym membership"));
    expect(possible.getByText("3 expenses · Consecutive calendar months")).toBeVisible();
    expect(possible.getByText("Identical each time")).toBeVisible();
    expect(possible.getByText("commitment-v1")).toBeVisible();
    expect(possible.getByText("Health · Monthly")).toBeVisible();
    expect(possible.getByText("Sunflower statement")).toBeVisible();

    for (const name of ["Paused commitments", "Ended commitments", "Reviewed changes", "Dismissed possible commitments"]) {
      expect(history(name)).not.toHaveAttribute("open");
      expect(historyHeading(name).closest("summary")).toHaveProperty("tabIndex", 0);
    }
    expect(screen.getByRole("heading", { name: "Paused rent" })).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Ended rent" })).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Streaming service" })).not.toBeVisible();
    await user.click(historyHeading("Paused commitments").closest("summary"));
    await user.click(historyHeading("Ended commitments").closest("summary"));
    await user.click(historyHeading("Reviewed changes").closest("summary"));
    await user.click(historyHeading("Dismissed possible commitments").closest("summary"));
    expect(screen.getByRole("heading", { name: "Paused rent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ended rent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Streaming service" })).toBeVisible();
    expect(within(history("Reviewed changes")).getByText("Current expectation")).toBeVisible();
    expect(within(history("Reviewed changes")).getByText("Observed change")).toBeVisible();
  });

  it("keeps the complete month-end timing pattern visible for saved commitments and disclosed for candidates", async () => {
    const user = userEvent.setup();
    const monthEndCandidate = { ...candidate, timingKind: "monthend", expectedDay: null, windowBeforeDays: 2, windowAfterDays: 1 };
    const monthEndCommitment = { ...commitment, timingKind: "monthend", expectedDay: null, windowBeforeDays: 2, windowAfterDays: 1 };
    useCommitments.mockReturnValue(state({ candidates: [monthEndCandidate], commitments: [monthEndCommitment], dismissedCandidates: [] }));
    render(<CommitmentsPage />);

    expect(within(card("Rent")).getByText("Month end, with a 2-day before / 1-day after window")).toBeVisible();
    const possible = within(card("Gym membership"));
    expect(possible.getByText("Month end, with a 2-day before / 1-day after window")).not.toBeVisible();
    await user.click(possible.getByLabelText("Details for Gym membership"));
    expect(possible.getByText("Month end, with a 2-day before / 1-day after window")).toBeVisible();
  });

  it("preserves a typed confirmation draft across disclosure, theme, resize, refresh, and stale-data errors", async () => {
    const user = userEvent.setup();
    let current = state();
    useCommitments.mockImplementation(() => current);
    const { rerender } = render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Review and confirm Gym membership" }));
    const form = screen.getByRole("form", { name: "Confirm commitment" });
    const name = within(form).getByLabelText("Name");
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Draft gym plan");
    expect(form.closest("details")).toBeNull();
    await user.click(screen.getByLabelText("Details for Gym membership"));
    await user.click(screen.getByLabelText("Details for Gym membership"));
    document.documentElement.dataset.theme = "dark";
    act(() => window.dispatchEvent(new Event("resize")));

    current = { ...current, loading: true };
    rerender(<CommitmentsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing commitments");
    expect(screen.getByLabelText("Name")).toHaveValue("Draft gym plan");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    current = { ...current, loading: false, busyKey: "confirm:fingerprint-1" };
    rerender(<CommitmentsPage />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Category")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    current = { ...current, busyKey: null, loadError: "Something went wrong. Try again." };
    rerender(<CommitmentsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText(/Displayed information may be out of date/)).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("Draft gym plan");
    expect(screen.getByRole("button", { name: "Confirm commitment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit Rent" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Confirm commitment" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("commitments-feedback")).toHaveFocus());
  });

  it("keeps an inactive draft visible and prevents its history from closing", async () => {
    const user = userEvent.setup();
    let current = state({ commitments: [{ ...commitment, lifecycle: "paused", name: "Paused rent" }], candidates: [] });
    useCommitments.mockImplementation(() => current);
    const { rerender } = render(<CommitmentsPage />);
    const pausedSummary = historyHeading("Paused commitments").closest("summary");
    await user.click(pausedSummary);
    await user.click(screen.getByRole("button", { name: "Edit Paused rent" }));
    const form = screen.getByRole("form", { name: "Save changes" });
    expect(history("Paused commitments")).toContainElement(form);
    expect(disclosure("Paused rent")).not.toContainElement(form);
    expect(pausedSummary).toHaveAttribute("aria-disabled", "true");
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Paused draft");
    await user.click(pausedSummary);
    expect(history("Paused commitments")).toHaveAttribute("open");
    current = { ...current, loading: true };
    rerender(<CommitmentsPage />);
    expect(screen.getByLabelText("Name")).toHaveValue("Paused draft");
    expect(history("Paused commitments")).toHaveAttribute("open");
  });

  it("preserves a dirty edit when the same commitment moves from active to paused during refresh", async () => {
    const user = userEvent.setup();
    let current = state({ candidates: [] });
    useCommitments.mockImplementation(() => current);
    const { rerender } = render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    const originalForm = screen.getByRole("form", { name: "Save changes" });
    await user.clear(within(originalForm).getByLabelText("Name"));
    await user.type(within(originalForm).getByLabelText("Name"), "Moved rent draft");
    await user.clear(within(originalForm).getByLabelText("Category"));
    await user.type(within(originalForm).getByLabelText("Category"), "home");

    current = { ...current, commitments: [{ ...commitment, lifecycle: "paused" }] };
    rerender(<CommitmentsPage />);

    const movedForm = screen.getByRole("form", { name: "Save changes" });
    const pausedSummary = historyHeading("Paused commitments").closest("summary");
    expect(history("Paused commitments")).toHaveAttribute("open");
    expect(history("Paused commitments")).toContainElement(movedForm);
    expect(pausedSummary).toHaveAttribute("aria-disabled", "true");
    expect(within(movedForm).getByLabelText("Name")).toHaveValue("Moved rent draft");
    expect(within(movedForm).getByLabelText("Category")).toHaveValue("home");
    await user.click(pausedSummary);
    expect(history("Paused commitments")).toHaveAttribute("open");

    await user.click(within(movedForm).getByRole("button", { name: "Save changes" }));
    expect(current.updateCommitment).toHaveBeenCalledExactlyOnceWith("commitment-1", {
      name: "Moved rent draft", category: "home", cadence: "monthly", timingKind: "dayofmonth",
      expectedDayOfWeek: null, expectedDay: 1, expectedMonth: null, windowBeforeDays: 1, windowAfterDays: 1,
      amountMode: "fixed", expectedAmount: 1200, expectedMinimumAmount: null, expectedMaximumAmount: null,
    });
  });

  it("submits the exact candidate fingerprint and unchanged expectation payload", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Review and confirm Gym membership" }));
    const form = screen.getByRole("form", { name: "Confirm commitment" });
    const name = within(form).getByLabelText("Name");
    expect(within(form).getByLabelText("Expected day")).toHaveValue(15);
    await user.clear(name);
    await user.type(name, "Gym plan");
    await user.click(within(form).getByRole("button", { name: "Confirm commitment" }));
    expect(current.confirmCandidate).toHaveBeenCalledExactlyOnceWith({
      fingerprint: "fingerprint-1", name: "Gym plan", category: "health", cadence: "monthly", timingKind: "dayofmonth",
      expectedDayOfWeek: null, expectedDay: 15, expectedMonth: null, windowBeforeDays: 0, windowAfterDays: 0,
      amountMode: "fixed", expectedAmount: "20.00", expectedMinimumAmount: null, expectedMaximumAmount: null,
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "Confirm commitment" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your commitments" })).toHaveFocus());
  });

  it("edits a saved expectation with its existing payload contract and restores cancel focus", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Rent" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    const form = screen.getByRole("form", { name: "Save changes" });
    await user.clear(within(form).getByLabelText("Name"));
    await user.type(within(form).getByLabelText("Name"), "Apartment rent");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(current.updateCommitment).toHaveBeenCalledExactlyOnceWith("commitment-1", {
      name: "Apartment rent", category: "housing", cadence: "monthly", timingKind: "dayofmonth", expectedDayOfWeek: null,
      expectedDay: 1, expectedMonth: null, windowBeforeDays: 1, windowAfterDays: 1, amountMode: "fixed",
      expectedAmount: 1200, expectedMinimumAmount: null, expectedMaximumAmount: null,
    });
  });

  it("uses the exact pause, reactivate, ended-to-paused, and confirmed-end lifecycle transitions", async () => {
    const user = userEvent.setup();
    const paused = { ...commitment, id: "commitment-2", name: "Paused rent", lifecycle: "paused" };
    const ended = { ...commitment, id: "commitment-3", name: "Ended rent", lifecycle: "ended" };
    const current = state({ commitments: [commitment, paused, ended], candidates: [] });
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Pause Rent" }));
    expect(current.updateLifecycle).toHaveBeenLastCalledWith("commitment-1", "paused");
    await user.click(historyHeading("Paused commitments").closest("summary"));
    await user.click(screen.getByRole("button", { name: "Reactivate Paused rent" }));
    expect(current.updateLifecycle).toHaveBeenLastCalledWith("commitment-2", "active");
    await user.click(historyHeading("Ended commitments").closest("summary"));
    await user.click(screen.getByLabelText("Details for Ended rent"));
    await user.click(screen.getByRole("button", { name: "Pause Ended rent" }));
    expect(current.updateLifecycle).toHaveBeenLastCalledWith("commitment-3", "paused");
    await user.click(screen.getByLabelText("Details for Rent"));
    await user.click(screen.getByRole("button", { name: "End Rent" }));
    const confirmation = screen.getByRole("group", { name: "End Rent" });
    expect(confirmation.closest("details")).toBeNull();
    expect(within(confirmation).getByRole("button", { name: "Confirm end" })).toHaveFocus();
    await user.click(within(confirmation).getByRole("button", { name: "Confirm end" }));
    expect(current.updateLifecycle).toHaveBeenLastCalledWith("commitment-1", "ended");
  });

  it("locks competing actions during edit and restores the Details end trigger after cancellation", async () => {
    const user = userEvent.setup();
    useCommitments.mockReturnValue(state({ commitmentChanges: [commitmentChange] }));
    render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Edit Rent" }));
    expect(screen.getByRole("button", { name: "Review and confirm Gym membership" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss Gym membership" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept amount change for Gym plan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByLabelText("Details for Rent"));
    await user.click(screen.getByRole("button", { name: "End Rent" }));
    expect(screen.getByRole("button", { name: "Confirm end" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel ending" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "End Rent" })).toHaveFocus());
    expect(disclosure("Rent")).toHaveAttribute("open");
  });

  it("dismisses and reconsiders only exact candidate fingerprints and focuses the disclosed destination", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Dismiss Gym membership" }));
    expect(current.dismissCandidate).toHaveBeenCalledExactlyOnceWith("fingerprint-1");
    expect(history("Dismissed possible commitments")).toHaveAttribute("open");
    await waitFor(() => expect(historyHeading("Dismissed possible commitments").closest("summary")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Reconsider Streaming service" }));
    expect(current.reconsiderCandidate).toHaveBeenCalledExactlyOnceWith("fingerprint-2");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Possible commitments" })).toHaveFocus());
  });

  it("clears a candidate task when refreshed evidence replaces its fingerprint but retains it while the record remains", async () => {
    const user = userEvent.setup();
    let current = state();
    useCommitments.mockImplementation(() => current);
    const { rerender } = render(<CommitmentsPage />);
    await user.click(screen.getByRole("button", { name: "Review and confirm Gym membership" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Stale draft");
    current = { ...current, loadError: "Refresh failed" };
    rerender(<CommitmentsPage />);
    expect(screen.getByLabelText("Name")).toHaveValue("Stale draft");
    current = { ...current, loadError: null, candidates: [{ ...candidate, fingerprint: "replacement-fingerprint" }] };
    rerender(<CommitmentsPage />);
    await waitFor(() => expect(screen.queryByRole("form", { name: "Confirm commitment" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Review and confirm Gym membership" })).toBeEnabled();
  });

  it("shows honest empty, refresh, and retry states without inventing forecasts or manual creation", async () => {
    const user = userEvent.setup();
    let current = state({ candidates: [], dismissedCandidates: [], commitments: [], commitmentChanges: [] });
    useCommitments.mockImplementation(() => current);
    const { rerender } = render(<CommitmentsPage />);
    expect(screen.getByText("No commitments confirmed yet.")).toBeInTheDocument();
    expect(screen.getByText("No commitment changes need your review.")).toBeInTheDocument();
    expect(screen.getByText("No possible commitments need your review.")).toBeInTheDocument();
    expect(screen.getByText("No reviewed changes.")).not.toBeVisible();
    expect(screen.getByText("No dismissed possible commitments.")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: /add|create.*commitment/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/next payment|next commitment|upcoming commitment/i)).not.toBeInTheDocument();

    current = { ...current, loading: true };
    rerender(<CommitmentsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing commitments");
    expect(screen.getByRole("heading", { name: "Your commitments" })).toBeInTheDocument();
    current = { ...current, loading: false, loadError: "Something went wrong. Try again." };
    rerender(<CommitmentsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Refresh commitments" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Refresh commitments" }));
    expect(current.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows initial loading and a retryable initial error without false empty content", async () => {
    const refresh = vi.fn();
    useCommitments.mockReturnValue(state({ loading: true, candidates: [], dismissedCandidates: [], commitments: [], refresh }));
    const { rerender } = render(<CommitmentsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading commitments");
    expect(screen.queryByRole("heading", { name: "Your commitments" })).not.toBeInTheDocument();
    useCommitments.mockReturnValue(state({ loading: false, loadError: "Something went wrong. Try again.", candidates: [], dismissedCandidates: [], commitments: [], refresh }));
    rerender(<CommitmentsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByText("No commitments confirmed yet.")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
