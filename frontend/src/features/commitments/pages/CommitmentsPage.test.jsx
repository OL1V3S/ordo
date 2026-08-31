import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommitments } from "../hooks/useCommitments";
import CommitmentsPage from "./CommitmentsPage";

vi.mock("../hooks/useCommitments", () => ({ useCommitments: vi.fn() }));

const evidence = [
  { expenseId: 1, date: "2026-05-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
  { expenseId: 2, date: "2026-06-15", amount: 20, description: "Gym membership", category: "health", source: "sunflower_pdf" },
  { expenseId: 3, date: "2026-07-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
];

const candidate = {
  fingerprint: "fingerprint-1",
  algorithmVersion: "commitment-v1",
  description: "Gym membership",
  category: "health",
  cadence: "monthly",
  timingKind: "dayofmonth",
  expectedDayOfWeek: null,
  expectedDay: 15,
  expectedMonth: null,
  windowBeforeDays: 0,
  windowAfterDays: 0,
  observedAmountMode: "fixed",
  observedMedianAmount: 20,
  observedMinimumAmount: 20,
  observedMaximumAmount: 20,
  coveredFrom: "2026-05-15",
  coveredTo: "2026-07-15",
  occurrenceCount: 3,
  evidenceRule: "consecutive_calendar_months",
  evidence,
};

const dismissedCandidate = {
  ...candidate,
  fingerprint: "fingerprint-2",
  description: "Streaming service",
  evidence: evidence.map((item) => ({ ...item, description: "Streaming service" })),
};

const commitment = {
  id: "commitment-1",
  name: "Rent",
  category: "housing",
  lifecycle: "active",
  cadence: "monthly",
  timingKind: "dayofmonth",
  expectedDayOfWeek: null,
  expectedDay: 1,
  expectedMonth: null,
  windowBeforeDays: 1,
  windowAfterDays: 1,
  amountMode: "fixed",
  expectedAmount: 1200,
  expectedMinimumAmount: null,
  expectedMaximumAmount: null,
  evidence: evidence.map((item) => ({ ...item, description: "Rent", amount: 1200, category: "housing" })),
};

function state(overrides = {}) {
  return {
    candidates: [candidate],
    dismissedCandidates: [dismissedCandidate],
    commitments: [commitment],
    commitmentChanges: [],
    changeEvaluatedOn: null,
    changeReviewEnabled: false,
    loading: false,
    loadError: null,
    actionError: null,
    notice: null,
    busyKey: null,
    refresh: vi.fn(),
    clearMessages: vi.fn(),
    dismissCandidate: vi.fn().mockResolvedValue({}),
    reconsiderCandidate: vi.fn().mockResolvedValue({}),
    confirmCandidate: vi.fn().mockResolvedValue({}),
    updateCommitment: vi.fn().mockResolvedValue({}),
    updateLifecycle: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("Commitments workspace", () => {
  beforeEach(() => useCommitments.mockReturnValue(state()));

  it("shows explainable proposals, provenance, confirmed state, and reversible dismissals", () => {
    render(<CommitmentsPage />);

    expect(screen.getByRole("heading", { name: "Commitments", level: 1 })).toBeInTheDocument();
    const activeCard = screen.getByRole("heading", { name: "Gym membership" }).closest("article");
    expect(within(activeCard).getByText("3 expenses · Consecutive calendar months")).toBeInTheDocument();
    expect(within(activeCard).getByText("Identical each time")).toBeInTheDocument();
    expect(within(activeCard).getByText("commitment-v1")).toBeInTheDocument();
    expect(screen.getAllByText("Sunflower statement")).toHaveLength(3);
    expect(screen.getAllByText("Manual entry")).toHaveLength(6);
    expect(screen.getByRole("heading", { name: "Rent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Streaming service" })).toBeInTheDocument();
    expect(screen.queryByText(/revision/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Changes to review" })).not.toBeInTheDocument();
  });

  it("places the enabled change workflow before confirmed commitments", () => {
    useCommitments.mockReturnValue(state({ changeReviewEnabled: true }));
    render(<CommitmentsPage />);

    const changes = screen.getByRole("heading", { name: "Changes to review" });
    const confirmed = screen.getByRole("heading", { name: "Confirmed commitments" });
    expect(changes.compareDocumentPosition(confirmed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("displays both saved timing windows for month-end proposals and commitments", () => {
    const monthEndCandidate = {
      ...candidate,
      timingKind: "monthend",
      expectedDay: null,
      windowBeforeDays: 2,
      windowAfterDays: 1,
    };
    const monthEndCommitment = {
      ...commitment,
      timingKind: "monthend",
      expectedDay: null,
      windowBeforeDays: 2,
      windowAfterDays: 1,
    };
    useCommitments.mockReturnValue(state({
      candidates: [monthEndCandidate],
      commitments: [monthEndCommitment],
      dismissedCandidates: [],
    }));

    render(<CommitmentsPage />);

    expect(screen.getAllByText("Month end, with a 2-day before / 1-day after window")).toHaveLength(2);
  });

  it("prefills an editable review form and confirms only the reviewed fingerprint", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    const card = screen.getByRole("heading", { name: "Gym membership" }).closest("article");

    await user.click(within(card).getByRole("button", { name: "Review and confirm" }));
    const name = within(card).getByLabelText("Name");
    expect(name).toHaveValue("Gym membership");
    expect(within(card).getByLabelText("Expected day")).toHaveValue(15);
    await user.clear(name);
    await user.type(name, "Gym plan");
    await user.click(within(card).getByRole("button", { name: "Confirm commitment" }));

    expect(current.confirmCandidate).toHaveBeenCalledWith({
      fingerprint: "fingerprint-1",
      name: "Gym plan",
      category: "health",
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
    });
  });

  it("dismisses active proposals and reconsiders dismissed proposals", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);

    const activeCard = screen.getByRole("heading", { name: "Gym membership" }).closest("article");
    const dismissedCard = screen.getByRole("heading", { name: "Streaming service" }).closest("article");
    await user.click(within(activeCard).getByRole("button", { name: "Dismiss" }));
    await user.click(within(dismissedCard).getByRole("button", { name: "Reconsider" }));

    expect(current.dismissCandidate).toHaveBeenCalledWith("fingerprint-1");
    expect(current.reconsiderCandidate).toHaveBeenCalledWith("fingerprint-2");
  });

  it("edits a confirmed expectation and controls its lifecycle", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    render(<CommitmentsPage />);
    const card = screen.getByRole("heading", { name: "Rent" }).closest("article");

    await user.click(within(card).getByRole("button", { name: "Edit expectation" }));
    const name = within(card).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Apartment rent");
    await user.click(within(card).getByRole("button", { name: "Save changes" }));
    expect(current.updateCommitment).toHaveBeenCalledWith(
      "commitment-1",
      expect.objectContaining({ name: "Apartment rent", expectedAmount: 1200 })
    );

    await user.selectOptions(within(card).getByLabelText("Lifecycle"), "paused");
    await user.click(within(card).getByRole("button", { name: "Update status" }));
    expect(current.updateLifecycle).toHaveBeenCalledWith("commitment-1", "paused");
  });

  it("shows honest empty states when there is no derived or confirmed state", () => {
    useCommitments.mockReturnValue(state({
      candidates: [],
      dismissedCandidates: [],
      commitments: [],
    }));
    render(<CommitmentsPage />);

    expect(screen.getByText("No commitment proposals need your review.")).toBeInTheDocument();
    expect(screen.getByText("No commitments confirmed yet.")).toBeInTheDocument();
    expect(screen.getByText("No dismissed proposals.")).toBeInTheDocument();
  });

  it("shows safe load errors and a retry control", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    useCommitments.mockReturnValue(state({
      candidates: [],
      dismissedCandidates: [],
      commitments: [],
      loadError: "Something went wrong. Try again.",
      refresh,
    }));
    render(<CommitmentsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalled();
  });
});
