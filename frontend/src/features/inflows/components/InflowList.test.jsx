import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import InflowList from "./InflowList";
import "../../../shared/localization/i18n";

const first = { id: 7, description: "Client Deposit", amount: 1250.5, date: "2026-08-14" };
const duplicate = { id: 8, description: "Client Deposit", amount: 1250.5, date: "2026-08-14" };

function listProps(overrides = {}) {
  return {
    inflows: [first],
    totalCount: 1,
    filteredCount: 1,
    showAll: false,
    onShowAll: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    disabled: false,
    readUnavailable: false,
    taskRecordId: null,
    ...overrides,
  };
}

describe("InflowList", () => {
  it("distinguishes a true empty ledger from a search with no matches", () => {
    const { rerender } = render(<InflowList {...listProps({ inflows: [], totalCount: 0, filteredCount: 0 })} />);
    expect(screen.getByText("No cash in recorded yet.")).toBeInTheDocument();

    rerender(<InflowList {...listProps({ inflows: [], totalCount: 4, filteredCount: 0 })} />);
    expect(screen.getByText("No cash in matches this search.")).toBeInTheDocument();
    expect(screen.queryByText("No cash in recorded yet.")).not.toBeInTheDocument();
  });

  it("renders one responsive table DOM with exact descriptions and formatted values", () => {
    render(<InflowList {...listProps()} />);

    const region = screen.getByRole("region", { name: "Cash in table" });
    expect(within(region).getByRole("table")).toBeInTheDocument();
    expect(within(region).getAllByRole("table")).toHaveLength(1);
    expect(within(region).getByText("Cash in", { selector: "caption" })).toBeInTheDocument();
    expect(within(region).getByText("Client Deposit")).toBeVisible();
    expect(within(region).getByText("$1,250.50")).toBeVisible();
  });

  it("gives duplicate rows distinct action names and passes each opener", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<InflowList {...listProps({ inflows: [first, duplicate], totalCount: 2, filteredCount: 2, onEdit, onDelete })} />);

    const editSeven = screen.getByRole("button", { name: /Edit cash in Client Deposit .* record 7$/ });
    const editEight = screen.getByRole("button", { name: /Edit cash in Client Deposit .* record 8$/ });
    const deleteSeven = screen.getByRole("button", { name: /Delete cash in Client Deposit .* record 7$/ });
    expect(editSeven).toHaveTextContent("Edit");
    expect(deleteSeven).toHaveTextContent("Delete");
    expect(editEight).not.toHaveAccessibleName(editSeven.getAttribute("aria-label"));

    await user.click(editSeven);
    await user.click(deleteSeven);
    expect(onEdit).toHaveBeenCalledWith(first, editSeven);
    expect(onDelete).toHaveBeenCalledWith(first, deleteSeven);
  });

  it("offers Show all only above ten filtered results", async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const { rerender } = render(<InflowList {...listProps({ filteredCount: 10, onShowAll })} />);
    expect(screen.queryByRole("button", { name: "Show all cash in" })).not.toBeInTheDocument();

    rerender(<InflowList {...listProps({ filteredCount: 11, onShowAll })} />);
    await user.click(screen.getByRole("button", { name: "Show all cash in" }));
    expect(onShowAll).toHaveBeenCalledOnce();

    rerender(<InflowList {...listProps({ filteredCount: 11, showAll: true, onShowAll })} />);
    expect(screen.queryByRole("button", { name: "Show all cash in" })).not.toBeInTheDocument();
  });

  it("locks stale row actions and highlights the active task record", () => {
    const { rerender } = render(<InflowList {...listProps({ readUnavailable: true, taskRecordId: 7 })} />);
    const row = screen.getByText("Client Deposit").closest("tr");
    expect(row).toHaveClass("inflow-row--task");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(within(row).getByRole("button", { name: /^Edit cash in/ })).toBeDisabled();
    expect(within(row).getByRole("button", { name: /^Delete cash in/ })).toBeDisabled();

    rerender(<InflowList {...listProps({ disabled: true })} />);
    expect(screen.getByRole("button", { name: /^Edit cash in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Delete cash in/ })).toBeDisabled();
  });
});
