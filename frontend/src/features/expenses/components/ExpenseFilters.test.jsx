import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ExpenseFilters from "./ExpenseFilters";
import "../../../shared/localization/i18n";

function filterProps(overrides = {}) {
  return {
    searchTerm: "",
    setSearchTerm: vi.fn(),
    dateFilter: "all",
    setDateFilter: vi.fn(),
    customStartDate: "",
    setCustomStartDate: vi.fn(),
    customEndDate: "",
    setCustomEndDate: vi.fn(),
    categoryFilter: "",
    setCategoryFilter: vi.fn(),
    ...overrides,
  };
}

describe("ExpenseFilters", () => {
  it("keeps search visible and date and category controls in a native disclosure", () => {
    render(<ExpenseFilters {...filterProps()} />);

    expect(screen.getByRole("searchbox", { name: "Search expenses" })).toBeVisible();
    expect(screen.getByText("Filter by date or category").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Date range")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  it("summarizes active filters and clears every filter value", async () => {
    const user = userEvent.setup();
    const props = filterProps({
      searchTerm: "coffee",
      dateFilter: "custom",
      customStartDate: "2026-08-01",
      customEndDate: "2026-08-31",
      categoryFilter: "Food",
    });
    render(<ExpenseFilters {...props} />);

    expect(screen.getByText(/Search: “coffee”/)).toHaveTextContent(
      "Search: “coffee” · Custom range: 2026-08-01 – 2026-08-31 · Category: Food",
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(props.setSearchTerm).toHaveBeenCalledWith("");
    expect(props.setDateFilter).toHaveBeenCalledWith("all");
    expect(props.setCustomStartDate).toHaveBeenCalledWith("");
    expect(props.setCustomEndDate).toHaveBeenCalledWith("");
    expect(props.setCategoryFilter).toHaveBeenCalledWith("");
  });
});
