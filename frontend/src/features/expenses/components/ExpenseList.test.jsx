import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ExpenseList from "./ExpenseList";
import "../../../shared/localization/i18n";

const expense = { id: 7, description: "coffee", amount: 4.5, date: "2026-08-14", category: "food" };

describe("ExpenseList (read-only table)", () => {
  it("shows the empty text and no match/filter wording", () => {
    render(<ExpenseList expenses={[]} />);
    expect(screen.getByText("No expenses recorded yet.")).toBeVisible();
  });

  it("keeps one table DOM with mobile labels and no Actions column or buttons", () => {
    render(<ExpenseList expenses={[expense]} />);
    const tableRegion = screen.getByRole("region", { name: "Expenses table" });
    const row = within(tableRegion).getByText("Coffee").closest("tr");
    expect(within(tableRegion).getByText("Expenses", { selector: "caption" })).toBeInTheDocument();
    expect(row.querySelector('[data-label="Amount ($)"]')).toHaveTextContent("4.50");
    expect(within(tableRegion).queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(within(tableRegion).queryAllByRole("button")).toHaveLength(0);
  });

  it("renders high-value strings exactly and flags ambiguous legacy numbers for review", () => {
    const { rerender } = render(<ExpenseList expenses={[{ ...expense, amount: "9999999999999999.99" }]} />);
    expect(screen.getByText("9,999,999,999,999,999.99")).toBeVisible();
    rerender(<ExpenseList expenses={[{ ...expense, amount: Number("9999999999999999") }]} />);
    expect(screen.getByText("Amount needs review")).toBeVisible();
  });

  it("renders every row in the order received (newest first from the backend)", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...expense, id: 12 - i, description: `item${12 - i}` }));
    render(<ExpenseList expenses={rows} />);
    const body = screen.getAllByRole("rowgroup").at(-1);
    const names = within(body).getAllByRole("row").map((row) => row.querySelector("td").textContent);
    expect(names).toEqual(rows.map((r) => `Item${r.id}`));
  });

  it("adds the row menu with the unchanged action names only when rowActions is provided", async () => {
    const user = userEvent.setup();
    const rowActions = { getState: vi.fn(() => ({ canEdit: true, canDelete: true })), onEdit: vi.fn(), onDelete: vi.fn() };
    render(<ExpenseList expenses={[expense]} rowActions={rowActions} />);
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    const trigger = screen.getByRole("button", { name: "Actions for expense Coffee from 08/14/2026, record 7" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Edit expense Coffee from 08/14/2026, record 7" }));
    expect(rowActions.onEdit).toHaveBeenCalledWith({ kind: "expense", recordId: 7 }, trigger);
  });
});
