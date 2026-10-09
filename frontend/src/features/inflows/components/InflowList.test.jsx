import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import InflowList from "./InflowList";
import "../../../shared/localization/i18n";

const first = { id: 7, description: "Client Deposit", amount: 1250.5, date: "2026-08-14" };
const second = { id: 8, description: "Client Deposit", amount: 1250.5, date: "2026-08-14" };

describe("InflowList (read-only table)", () => {
  it("shows the true empty text", () => {
    render(<InflowList inflows={[]} />);
    expect(screen.getByText("No cash in recorded yet.")).toBeInTheDocument();
  });

  it("renders one responsive table with exact descriptions, formatted values and no actions", () => {
    render(<InflowList inflows={[first, second]} />);
    const region = screen.getByRole("region", { name: "Cash in table" });
    expect(within(region).getAllByRole("table")).toHaveLength(1);
    expect(within(region).getByText("Cash in", { selector: "caption" })).toBeInTheDocument();
    expect(within(region).getAllByText("$1,250.50")).toHaveLength(2);
    expect(within(region).queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Show all cash in" })).toBeNull();
  });

  it("gives duplicate rows distinct menu triggers and passes each trigger as the opener", async () => {
    const user = userEvent.setup();
    const rowActions = { getState: () => ({ canEdit: true, canDelete: true }), onEdit: vi.fn(), onDelete: vi.fn() };
    render(<InflowList inflows={[first, second]} rowActions={rowActions} />);
    const seven = screen.getByRole("button", { name: /^Actions for cash in Client Deposit .* record 7$/ });
    expect(screen.getByRole("button", { name: /^Actions for cash in Client Deposit .* record 8$/ })).toBeVisible();
    await user.click(seven);
    await user.click(screen.getByRole("button", { name: /^Delete cash in Client Deposit .* record 7$/ }));
    expect(rowActions.onDelete).toHaveBeenCalledWith({ kind: "account_inflow", recordId: 7 }, seven);
    expect(seven).toHaveFocus();
  });
});
