import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./AnalyticsPage";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { useBudgetLimits } from "../../budgetLimits/hooks/useBudgetLimits";

vi.mock("../../expenses/hooks/useExpenses", () => ({ useExpenses: vi.fn() }));
vi.mock("../../budgetLimits/hooks/useBudgetLimits", () => ({ useBudgetLimits: vi.fn() }));

const refreshExpenses = vi.fn();
const refreshLimits = vi.fn();

function renderPage() {
  return render(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
}

describe("monthly spending insights page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0));
    useExpenses.mockReturnValue({
      expenses: [
        { id: 1, description: "Groceries", category: "food", amount: 90, date: "2026-08-02" },
        { id: 2, description: "Train", category: "transport", amount: 10, date: "2026-08-03" },
        { id: 3, description: "Rent", category: "bills", amount: 75, date: "2026-07-02" },
      ],
      loading: false,
      error: null,
      refresh: refreshExpenses,
    });
    useBudgetLimits.mockReturnValue({
      budgetLimits: [
        { id: 1, category: "food", limitAmount: 100 },
        { id: 2, category: "transport", limitAmount: 0 },
      ],
      loading: false,
      error: null,
      refresh: refreshLimits,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows the selected total, ranked categories, budgets, comparison, and largest expenses", () => {
    renderPage();

    expect(screen.getByLabelText("Month")).toHaveValue("2026-08");
    expect(useBudgetLimits).toHaveBeenLastCalledWith("2026-08");
    expect(screen.getByText("$100.00")).toBeInTheDocument();

    const breakdown = screen.getByRole("heading", { name: "Where the money went" }).closest("section");
    const rows = within(breakdown).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Food");
    expect(rows[0]).toHaveTextContent("$90.00 · 90.0%");
    expect(rows[1]).toHaveTextContent("Transport");

    const budget = screen.getByRole("heading", { name: "Budget status by category" }).closest("section");
    expect(budget).toHaveTextContent("Near Limit");
    expect(budget).toHaveTextContent("Percentage used: Not applicable for a $0 limit");

    expect(screen.getByRole("heading", { name: "Month-over-month change" }).closest("section"))
      .toHaveTextContent("+$25.00");
    expect(screen.getByRole("heading", { name: "Largest expenses" }).closest("section"))
      .toHaveTextContent("Groceries");
    expect(screen.getByRole("link", { name: "Review transactions" })).toHaveAttribute("href", "/transactions");
  });

  it("offers current and represented historical months and updates selected-month limits", () => {
    renderPage();
    const selector = screen.getByLabelText("Month");
    expect(within(selector).getAllByRole("option").map(({ value }) => value)).toEqual(["2026-08", "2026-07"]);

    fireEvent.change(selector, { target: { value: "2026-07" } });
    expect(useBudgetLimits).toHaveBeenLastCalledWith("2026-07");
    expect(screen.getByRole("heading", { name: "Monthly recorded spending" }).closest("section"))
      .toHaveTextContent("$75.00");
  });

  it("renders expense loading and blocking error states without transient insights", () => {
    useExpenses.mockReturnValue({ expenses: [], loading: true, error: null, refresh: refreshExpenses });
    const { rerender } = renderPage();
    expect(screen.getByText("Loading spending insights...")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Monthly recorded spending" })).not.toBeInTheDocument();

    useExpenses.mockReturnValue({ expenses: [], loading: false, error: new Error("failed"), refresh: refreshExpenses });
    rerender(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn’t load recorded expenses");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshExpenses).toHaveBeenCalledOnce();
  });

  it("keeps expense insights visible when budget limits fail", () => {
    useBudgetLimits.mockReturnValue({
      budgetLimits: [], loading: false, error: new Error("failed"), refresh: refreshLimits,
    });
    renderPage();

    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Budget limits are unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshLimits).toHaveBeenCalledOnce();
  });

  it("shows honest empty states for a month without expenses or limits", () => {
    useExpenses.mockReturnValue({ expenses: [], loading: false, error: null, refresh: refreshExpenses });
    useBudgetLimits.mockReturnValue({ budgetLimits: [], loading: false, error: null, refresh: refreshLimits });
    renderPage();

    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    expect(screen.getByText("No recorded spending for this month.")).toBeInTheDocument();
    expect(screen.getByText("No budget limits are set for this month.")).toBeInTheDocument();
    expect(screen.getByText("No category changes to show between these months.")).toBeInTheDocument();
    expect(screen.getByText("No expenses to rank for this month.")).toBeInTheDocument();
    expect(screen.getByText("Neither month has recorded spending.")).toBeInTheDocument();
  });
});
