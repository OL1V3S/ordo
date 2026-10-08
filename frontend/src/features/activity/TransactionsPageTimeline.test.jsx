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

describe("Timeline row actions on the Activity page", () => {
  const lunchRow = { kind: "expense", recordId: 42, date: "2026-09-01", amount: "5.00", description: "Lunch", category: "food", paycheck: null };
  const oddRow = { kind: "expense", recordId: 43, date: "2026-09-02", amount: "-5.00", description: "Odd", category: "bills", paycheck: null };
  const transferRow = { kind: "account_inflow", recordId: 42, date: "2026-09-01", amount: "24.15", description: "Transfer from Savings", category: null, paycheck: null };
  const odd = { id: 43, description: "Odd", category: "bills", amount: "-5.00", date: "2026-09-02" };
  const transfer = { id: 42, description: "Transfer from Savings", amount: 24.15, date: "2026-09-01" };
  const region = () => screen.getByRole("region", { name: "Activity timeline" });
  const tl = (name) => within(region()).getByRole("button", { name });
  const withRows = (items) => useActivityTimeline.mockImplementation(() => timelineState({ items }));
  const httpError = (status) => Object.assign(new Error("http"), { response: { status } });

  it("opens the inline expense edit from the timeline, focuses it, saves unchanged, and refreshes the timeline", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { ...expensePayload, updateExpense: vi.fn().mockResolvedValue({ refreshFailed: false }) } });
    withRows([lunchRow]);
    renderPage();

    await user.click(tl("Edit expense Lunch from Sep 1, 2026, record 42"));
    await waitFor(() => expect(screen.getByLabelText("Edit description")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(expenses.updateExpense).toHaveBeenCalledExactlyOnceWith(42,
      { id: 42, description: "lunch", amount: "5.00", date: "2026-09-01", category: "food" });
    expect(timelineRefresh).toHaveBeenCalled();
  });

  it("returns focus to the timeline button on cancel and to the Spending heading when the row is gone", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: expensePayload });
    withRows([lunchRow]);
    const view = renderPage();

    const edit = tl("Edit expense Lunch from Sep 1, 2026, record 42");
    await user.click(edit);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(edit).toHaveFocus());

    await user.click(edit);
    withRows([]);
    view.rerender(<I18nextProvider i18n={i18n}><TransactionsPage /></I18nextProvider>);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Spending activity" })).toHaveFocus());
  });

  it("deletes an expense from the timeline only after confirmation", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: expensePayload });
    withRows([lunchRow]);
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    const del = tl("Delete expense Lunch from Sep 1, 2026, record 42");

    await user.click(del);
    expect(expenses.deleteExpense).not.toHaveBeenCalled();
    await user.click(del);
    expect(expenses.deleteExpense).toHaveBeenCalledExactlyOnceWith(42);
    expect(timelineRefresh).toHaveBeenCalled();
  });

  it("dispatches by kind when an expense and a cash in share an id", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: expensePayload, cash: { inflows: [transfer] } });
    withRows([lunchRow, transferRow]);
    renderPage();

    await user.click(tl("Edit cash in Transfer from Savings from Sep 1, 2026, record 42"));
    expect(within(document.getElementById("cash-in-task")).getByRole("form", { name: "Edit cash in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
  });

  it("opens the cash delete confirmation from the timeline and calls deleteInflow unchanged", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { inflows: [transfer] } });
    withRows([transferRow]);
    renderPage();

    await user.click(tl("Delete cash in Transfer from Savings from Sep 1, 2026, record 42"));
    const task = document.getElementById("cash-in-task");
    await waitFor(() => expect(within(task).getByRole("button", { name: "Confirm delete cash in" })).toHaveFocus());
    await user.click(within(task).getByRole("button", { name: "Confirm delete cash in" }));
    expect(cash.deleteInflow).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("returns cash Cancel focus to the timeline button, or the Cash in heading when the row is gone", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { inflows: [transfer] } });
    withRows([transferRow]);
    const view = renderPage();
    const del = tl("Delete cash in Transfer from Savings from Sep 1, 2026, record 42");

    await user.click(del);
    await user.click(within(document.getElementById("cash-in-task")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(del).toHaveFocus());

    await user.click(del);
    withRows([]);
    view.rerender(<I18nextProvider i18n={i18n}><TransactionsPage /></I18nextProvider>);
    await user.click(within(document.getElementById("cash-in-task")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Cash in" })).toHaveFocus());
  });

  it("disables Edit but not Delete for a legacy non-positive expense amount", () => {
    mockLists({ expenses: { expenses: [odd] } });
    withRows([oddRow]);
    renderPage();
    expect(tl("Edit expense Odd from Sep 2, 2026, record 43")).toBeDisabled();
    expect(tl("Delete expense Odd from Sep 2, 2026, record 43")).toBeEnabled();
  });

  it("disables actions for unresolved records, a loading or failed list, and while a cash task is open", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { expenses: [] }, cash: { inflows: [] } });
    withRows([lunchRow, transferRow]);
    const view = renderPage();
    for (const button of within(region()).getAllByRole("button", { name: /^(Edit|Delete) (expense|cash in)/ })) expect(button).toBeDisabled();
    view.unmount();

    mockLists({ expenses: { expenses: expensePayload.expenses, error: new Error("x") }, cash: { inflows: [transfer] } });
    renderPage();
    expect(tl(/^Edit expense Lunch/)).toBeDisabled();
    expect(tl(/^Edit cash in Transfer/)).toBeEnabled();
    await user.click(tl(/^Edit cash in Transfer/));
    expect(tl(/^Delete cash in Transfer/)).toBeDisabled();
    expect(tl(/^Delete expense Lunch/)).toBeDisabled();
  });

  it("disables cash actions while the add-expense form is open but keeps the expense actions as the list does", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: expensePayload, cash: { inflows: [transfer] } });
    withRows([lunchRow, transferRow]);
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(tl(/^Edit cash in/)).toBeDisabled();
    expect(tl(/^Edit expense Lunch/)).toBeEnabled();
  });

  it("shows the missing message on an expense delete 404, refreshes the timeline, and warns it may be stale", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { ...expensePayload, deleteExpense: vi.fn().mockRejectedValue(httpError(404)) } });
    withRows([lunchRow]);
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await user.click(tl(/^Delete expense Lunch/));

    expect(await screen.findByRole("alert")).toHaveTextContent(/This expense is no longer available\. Refresh spending activity/);
    expect(screen.getByText(/The activity timeline may be out of date/)).toBeInTheDocument();
    await waitFor(() => expect(timelineRefresh).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".activity-feedback")).toHaveFocus());
  });

  it("closes the open inline edit and moves focus to feedback on an expense update 404", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { ...expensePayload, updateExpense: vi.fn().mockRejectedValue(httpError(404)) } });
    withRows([lunchRow]);
    renderPage();

    await user.click(tl(/^Edit expense Lunch/));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer available/);
    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".activity-feedback")).toHaveFocus());
  });

  it("re-reads the timeline and warns it may be stale after a cash-in 404", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { inflows: [transfer], deleteInflow: vi.fn().mockRejectedValue(httpError(404)) } });
    withRows([transferRow]);
    renderPage();

    await user.click(tl(/^Delete cash in Transfer/));
    const task = document.getElementById("cash-in-task");
    await user.click(within(task).getByRole("button", { name: "Confirm delete cash in" }));

    await waitFor(() => expect(screen.getByText(/The activity timeline may be out of date/)).toBeInTheDocument());
    expect(timelineRefresh).toHaveBeenCalled();
  });
});
});
