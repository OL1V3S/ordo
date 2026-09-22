import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ExpenseList from "./ExpenseList";

const expense = {
  id: 7,
  description: "coffee",
  amount: 4.5,
  date: "2026-08-14",
  category: "food",
};

function listProps(overrides = {}) {
  return {
    expenses: [expense],
    totalCount: 1,
    filteredCount: 1,
    entriesPerPage: 10,
    showAll: false,
    onShowAll: vi.fn(),
    editingExpenseId: null,
    editingExpenseData: {},
    setEditingExpenseData: vi.fn(),
    onStartEdit: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("ExpenseList", () => {
  it("distinguishes an empty collection from filters with no matches", () => {
    const { rerender } = render(<ExpenseList {...listProps({ expenses: [], totalCount: 0 })} />);
    expect(screen.getByText("No expenses recorded yet.")).toBeInTheDocument();

    rerender(<ExpenseList {...listProps({ expenses: [], totalCount: 3 })} />);
    expect(screen.getByText("No expenses match these filters.")).toBeInTheDocument();
  });

  it("keeps one table DOM with mobile labels and passes the edit opener", async () => {
    const user = userEvent.setup();
    const onStartEdit = vi.fn();
    render(<ExpenseList {...listProps({ onStartEdit })} />);

    const tableRegion = screen.getByRole("region", { name: "Expenses table" });
    const row = within(tableRegion).getByText("Coffee").closest("tr");
    expect(within(tableRegion).getByText("Expenses", { selector: "caption" })).toBeInTheDocument();
    expect(row.querySelector('[data-label="Amount ($)"]')).toHaveTextContent("4.50");

    const editButton = within(row).getByRole("button", {
      name: "Edit expense Coffee from 08/14/2026, row 1",
    });
    await user.click(editButton);
    expect(onStartEdit).toHaveBeenCalledWith(expense, editButton);
  });

  it("renders high-value strings exactly and blocks edits of ambiguous legacy numbers", () => {
    const highExpense = { ...expense, amount: "9999999999999999.99" };
    const { rerender } = render(<ExpenseList {...listProps({ expenses: [highExpense] })} />);
    expect(screen.getByText("9,999,999,999,999,999.99")).toBeVisible();
    expect(screen.getByRole("button", { name: /Edit expense Coffee/ })).toBeEnabled();

    rerender(<ExpenseList {...listProps({ expenses: [{ ...expense, amount: Number("9999999999999999") }] })} />);
    expect(screen.getByText("Amount needs review")).toBeVisible();
    expect(screen.getByRole("button", { name: /Edit expense Coffee/ })).toBeDisabled();
  });

  it("locks other row actions and keeps an unavailable read draft cancelable", () => {
    const { rerender } = render(<ExpenseList {...listProps({ taskLocked: true })} />);
    expect(screen.getByRole("button", { name: "Edit expense Coffee from 08/14/2026, row 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete expense Coffee from 08/14/2026, row 1" })).toBeDisabled();

    rerender(<ExpenseList {...listProps({ editingExpenseId: 7, readUnavailable: true })} />);
    expect(screen.getByLabelText("Edit description")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    rerender(<ExpenseList {...listProps({ editingExpenseId: 7, busy: true })} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Edit description")).toBeDisabled();
    expect(screen.getByLabelText("Edit amount")).toBeDisabled();
    expect(screen.getByLabelText("Edit date")).toBeDisabled();
    expect(screen.getByLabelText("Edit category")).toBeDisabled();
  });
});
