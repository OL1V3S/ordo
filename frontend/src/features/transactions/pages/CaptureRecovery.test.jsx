import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsPage from "./TransactionsPage";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { useInflows } from "../../inflows/hooks/useInflows";
import { useImportPreview } from "../../importPreview/hooks/useImportPreview";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { markCaptureRecovery } from "../../home/recovery/captureRecovery";
import i18n from "../../../shared/localization/i18n";

vi.mock("../../expenses/hooks/useExpenses", () => ({ useExpenses: vi.fn() }));
vi.mock("../../inflows/hooks/useInflows", () => ({ useInflows: vi.fn() }));
vi.mock("../../importPreview/hooks/useImportPreview", () => ({ useImportPreview: vi.fn() }));

const expenses = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1, description: `Expense ${index + 1}`, category: "food", amount: "1.00", date: "2026-09-01",
}));
const expenseRefresh = vi.fn().mockResolvedValue({ stale: false });
function renderPage() {
  return render(<I18nextProvider i18n={i18n}><TransactionsPage /></I18nextProvider>);
}

beforeEach(() => {
  sessionStorage.clear(); establishSession("token", "owner@example.test");
  useExpenses.mockReturnValue({ expenses, loading: false, error: null, refresh: expenseRefresh, addExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() });
  useInflows.mockReturnValue({ inflows: [], loading: false, error: null, refresh: vi.fn(), createInflow: vi.fn(), updateInflow: vi.fn(), deleteInflow: vi.fn() });
  useImportPreview.mockReturnValue({ preview: null, sourceType: "", loading: false, processing: false, error: "", confirming: false,
    confirmation: null, confirmationIssue: null, selectedCount: 0, selectSource: vi.fn(), upload: vi.fn(), cancel: vi.fn(), updateRow: vi.fn(),
    confirm: vi.fn(), clearForReupload: vi.fn() });
});
afterEach(() => { clearSession(); sessionStorage.clear(); vi.clearAllMocks(); });

describe("uncertain Home write recovery in Activity", () => {
  it("shows every expense and clears the marker only after explicit acknowledgment", () => {
    markCaptureRecovery("expense");
    renderPage();
    expect(screen.getByText("An expense save could not be confirmed. Review the complete expense list below. Do not retry until you have checked it.")).toBeInTheDocument();
    expect(screen.getByText("Expense 12")).toBeInTheDocument();
    expect(screen.getByText("Expense 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "I checked the complete list" }));
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByText(/Ordo did not determine whether the entry was saved/)).toBeInTheDocument();
  });

  it("retains the marker and prevents acknowledgment when the full list failed", () => {
    markCaptureRecovery("expense");
    useExpenses.mockReturnValue({ expenses: [], loading: false, error: "unavailable", refresh: expenseRefresh,
      addExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() });
    renderPage();
    expect(screen.getByRole("button", { name: "I checked the complete list" })).toBeDisabled();
    expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry full list" }));
    expect(expenseRefresh).toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });
});
