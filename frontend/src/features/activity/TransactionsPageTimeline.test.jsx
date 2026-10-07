import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsPage from "../transactions/pages/TransactionsPage";
import { useExpenses } from "../expenses/hooks/useExpenses";
import { useInflows } from "../inflows/hooks/useInflows";
import { useImportPreview } from "../importPreview/hooks/useImportPreview";
import { useActivityTimeline } from "./hooks/useActivityTimeline";
import { clearSession, establishSession } from "../../shared/auth/session";
import { markCaptureRecovery } from "../home/recovery/captureRecovery";
import i18n from "../../shared/localization/i18n";

vi.mock("../expenses/hooks/useExpenses", () => ({ useExpenses: vi.fn() }));
vi.mock("../inflows/hooks/useInflows", () => ({ useInflows: vi.fn() }));
vi.mock("../importPreview/hooks/useImportPreview", () => ({ useImportPreview: vi.fn() }));
vi.mock("./hooks/useActivityTimeline", () => ({ useActivityTimeline: vi.fn() }));

const timelineRefresh = vi.fn();
const timelineItems = [
  { kind: "expense", recordId: 3, date: "2026-09-22", amount: "12.34", description: "Timeline coffee", category: "food", paycheck: null },
  { kind: "account_inflow", recordId: 3, date: "2026-09-21", amount: "2500.00", description: "Timeline payroll", category: null,
    paycheck: { profileId: "11111111-1111-1111-1111-111111111111", relation: "recorded_receipt" } },
];
const timelineState = (overrides = {}) => ({
  items: [], hasMore: false, loading: false, error: false, refreshFailed: false, malformed: false,
  loadingMore: false, loadMoreFailed: false, loadMore: vi.fn(), refresh: timelineRefresh, ...overrides,
});
const importHook = {
  preview: null, sourceType: "", loading: false, processing: false, error: "", confirming: false,
  confirmation: null, confirmationIssue: null, selectedCount: 0, selectSource: vi.fn(), upload: vi.fn(),
  cancel: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(), clearForReupload: vi.fn(),
};
const importPreview = {
  batchId: "11111111-1111-1111-1111-111111111111", sourceType: "sunflower_pdf", expiresAt: "2026-08-26T12:00:00Z",
  rows: [{
    rowId: "row-1", sourceRowOrdinal: 1, postedDate: "2026-08-12", amount: 8.5, direction: "debit",
    sourceDescription: "SYNTHETIC CAFE", sourceSection: "electronic_transactions", classification: "expense_candidate",
    isEligible: true, errors: [], warnings: [], isPossibleDuplicate: false, editableExpenseDescription: "Coffee",
    category: "food", selectedForImport: true,
  }],
};
const expensePayload = { expenses: [{ id: 42, description: "Lunch", category: "food", amount: "5.00", date: "2026-09-01" }] };
let expenses;
let cash;
let confirmSpy = null;

function renderPage() {
  return render(<I18nextProvider i18n={i18n}><TransactionsPage /></I18nextProvider>);
}
function mockLists(overrides = {}) {
  expenses = { expenses: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined),
    addExpense: vi.fn().mockResolvedValue({ refreshFailed: false }), updateExpense: vi.fn(),
    deleteExpense: vi.fn().mockResolvedValue({ refreshFailed: false }), ...overrides.expenses };
  cash = { inflows: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue({ stale: false }),
    createInflow: vi.fn().mockResolvedValue({ refreshFailed: false }), updateInflow: vi.fn(), deleteInflow: vi.fn(),
    ...overrides.cash };
  useExpenses.mockImplementation(() => expenses);
  useInflows.mockImplementation(() => cash);
}
async function fillNewExpense(user) {
  await user.click(screen.getByRole("button", { name: "Add expense" }));
  const task = document.getElementById("add-expense-task");
  await user.type(within(task).getByLabelText("Description"), "Synthetic meal");
  await user.type(within(task).getByLabelText("Amount"), "12.50");
  fireEvent.change(within(task).getByLabelText("Date"), { target: { value: "2026-09-01" } });
  await user.selectOptions(within(task).getByLabelText("Category"), "food");
  return task;
}

beforeEach(() => {
  sessionStorage.clear();
  establishSession("token", "owner@example.test");
  timelineRefresh.mockReset().mockResolvedValue({ stale: false });
  useActivityTimeline.mockImplementation(() => timelineState());
  useImportPreview.mockReturnValue({ ...importHook });
  mockLists();
});
afterEach(() => { clearSession(); sessionStorage.clear(); confirmSpy?.mockRestore(); confirmSpy = null; });

describe("Activity timeline on the Activity page", () => {
  it("adds a labelled timeline region above Spending activity and a Timeline section link", () => {
    useActivityTimeline.mockImplementation(() => timelineState({ items: timelineItems }));
    renderPage();

    const region = screen.getByRole("region", { name: "Activity timeline" });
    const spending = screen.getByRole("heading", { name: "Spending activity" });
    expect(region.compareDocumentPosition(spending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Activity sections" });
    expect(within(nav).getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "#activity-timeline-heading");
    expect(within(nav).getByRole("link", { name: "Spending" })).toHaveAttribute("href", "#spending-activity-heading");
    expect(within(nav).getByRole("link", { name: "Cash in" })).toHaveAttribute("href", "#cash-in-heading");
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Cash in" })).toBeInTheDocument();
  });

  it("localizes the section links in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      renderPage();

      const nav = screen.getByRole("navigation", { name: "Secciones de actividad" });
      expect(within(nav).getByRole("link", { name: "Cronología" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "Gastos" })).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "Entradas de dinero" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Actividad de gastos" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("issues no timeline request and hides the region and link while the uncertain-write marker is set", async () => {
    markCaptureRecovery("expense");
    renderPage();

    expect(useActivityTimeline.mock.calls.length).toBeGreaterThan(0);
    expect(useActivityTimeline.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
    expect(screen.queryByRole("region", { name: "Activity timeline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Timeline" })).not.toBeInTheDocument();
    expect(timelineRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "I checked the complete list" }));

    await waitFor(() => expect(useActivityTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true })));
    expect(screen.getByRole("region", { name: "Activity timeline" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timeline" })).toBeInTheDocument();
  });

  it("refreshes the timeline after a completed expense create without changing the write", async () => {
    const user = userEvent.setup();
    renderPage();
    await fillNewExpense(user);

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    expect(expenses.addExpense).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amount: "12.50", date: "2026-09-01", category: "food" }));
    expect(screen.getByRole("status")).toHaveTextContent("Expense saved.");
    expect(timelineRefresh).toHaveBeenCalledOnce();
  });

  it("refreshes the timeline after a completed expense delete", async () => {
    const user = userEvent.setup();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockLists({ expenses: expensePayload });
    renderPage();

    await user.click(screen.getByRole("button", { name: /^Delete expense/ }));

    expect(expenses.deleteExpense).toHaveBeenCalledExactlyOnceWith(42);
    expect(screen.getByRole("status")).toHaveTextContent("Expense deleted.");
    expect(timelineRefresh).toHaveBeenCalledOnce();
  });

  it("refreshes the timeline after a completed cash-in create with the unchanged payload", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add cash in", exact: true }));
    const form = screen.getByRole("form", { name: "Add cash in" });
    await user.type(within(form).getByLabelText("Description"), "  Refund  From Store  ");
    await user.type(within(form).getByLabelText("Amount"), "9999999999999999.99");
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-02" } });

    fireEvent.submit(form);

    await waitFor(() => expect(timelineRefresh).toHaveBeenCalledOnce());
    expect(cash.createInflow).toHaveBeenCalledExactlyOnceWith(
      { description: "Refund  From Store", amount: "9999999999999999.99", date: "2026-09-02" });
    expect(screen.getByText("Cash in saved. Reports use this entry’s posted date.")).toBeInTheDocument();
  });

  it("refreshes the timeline after the manual per-type refresh buttons", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Refresh activity" }));
    await waitFor(() => expect(timelineRefresh).toHaveBeenCalledTimes(1));
    expect(expenses.refresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Refresh cash in" }));
    await waitFor(() => expect(timelineRefresh).toHaveBeenCalledTimes(2));
    expect(cash.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes the timeline after an import that saved records and not after an empty one", async () => {
    const user = userEvent.setup();
    const saved = vi.fn().mockResolvedValue({
      batchId: importPreview.batchId, status: "confirmed", confirmedAt: "2026-08-25T21:00:00Z",
      importedExpenseCount: 1, importedInflowCount: 0,
    });
    useImportPreview.mockReturnValue({ ...importHook, preview: importPreview, sourceType: "sunflower_pdf", selectedCount: 1, confirm: saved });
    const view = renderPage();

    await user.click(screen.getByRole("button", { name: "Save 1 expense and 0 incoming deposits" }));

    expect(saved).toHaveBeenCalledOnce();
    expect(expenses.refresh).toHaveBeenCalledOnce();
    expect(timelineRefresh).toHaveBeenCalledOnce();
    view.unmount();

    timelineRefresh.mockClear();
    const empty = vi.fn().mockResolvedValue({
      batchId: importPreview.batchId, status: "confirmed", confirmedAt: "2026-08-25T21:00:00Z",
      importedExpenseCount: 0, importedInflowCount: 0,
    });
    useImportPreview.mockReturnValue({ ...importHook, preview: importPreview, sourceType: "sunflower_pdf", selectedCount: 1, confirm: empty });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Save 1 expense and 0 incoming deposits" }));

    expect(empty).toHaveBeenCalledOnce();
    expect(timelineRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ["rejecting", () => Promise.reject(new Error("timeline offline"))],
    ["throwing", () => { throw new Error("timeline defect"); }],
  ])("never lets a %s timeline refresh change a completed write", async (_name, behavior) => {
    const user = userEvent.setup();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockLists({ expenses: expensePayload });
    timelineRefresh.mockImplementation(behavior);
    renderPage();

    await user.click(screen.getByRole("button", { name: /^Delete expense/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Expense deleted.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-reads the timeline and warns it may be out of date after an unknown expense outcome", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { addExpense: vi.fn().mockRejectedValue(new Error("network")) } });
    renderPage();
    await fillNewExpense(user);

    await user.click(screen.getByRole("button", { name: "Save expense" }));

    await waitFor(() => expect(timelineRefresh).toHaveBeenCalled());
    expect(useActivityTimeline).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.getByText(/The activity timeline may be out of date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeInTheDocument();
  });

  it("re-reads the timeline and warns after an unknown cash-in outcome", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { createInflow: vi.fn().mockRejectedValue(new Error("network")) } });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add cash in", exact: true }));
    const form = screen.getByRole("form", { name: "Add cash in" });
    await user.type(within(form).getByLabelText("Description"), "Refund");
    await user.type(within(form).getByLabelText("Amount"), "5.00");
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-02" } });

    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText(/The activity timeline may be out of date/)).toBeInTheDocument());
    expect(timelineRefresh).toHaveBeenCalled();
  });
});
