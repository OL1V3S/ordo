import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CashFlowSummary from "./CashFlowSummary";
import { cashFlowFixture } from "../testFixtures";

describe("recorded cash-flow comparison", () => {
  it("aligns the cash-in stack and spending with exact amounts and a signed net in the same card", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "30000", netMinor: "-15000" });
    const { container } = render(<CashFlowSummary data={data} />);
    const card = screen.getByRole("region", { name: "Deposits and spending you recorded" });
    expect(card).toHaveTextContent("Recorded cash in$150.00");
    expect(card).toHaveTextContent("Spent$300.00");
    expect(within(card).getByRole("heading", { name: "Deposits minus spending" })).toBeInTheDocument();
    expect(card).toHaveTextContent("−$150.00");
    const bars = container.querySelectorAll(".cash-flow-bar");
    expect(bars[0]).toHaveAttribute("aria-hidden", "true");
    expect(bars[0].children[0]).toHaveStyle({ width: "40%" });
    expect(bars[0].children[1]).toHaveStyle({ width: "10%" });
    expect(bars[1].children[0]).toHaveStyle({ width: "100%" });
    const breakdown = screen.getByRole("list", { name: "Deposits breakdown" });
    expect(breakdown).toHaveTextContent("Confirmed paychecks $120.00");
    expect(breakdown).toHaveTextContent("Other cash in $30.00");
    expect(card).toHaveTextContent("Through August 14, 2026");
    expect(card).toHaveTextContent("Cash in spent200.0%");
  });
  it("keeps secondary counts, shares and evidence explanations in a native closed disclosure", () => {
    render(<CashFlowSummary data={cashFlowFixture("2026-08", { editedPaycheckInflowCount: 1 })} />);
    const disclosure = screen.getByText("About these figures").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("Other cash in is every remaining recorded inflow and can include unlinked paychecks");
    expect(disclosure).toHaveTextContent("active, paused, and ended profiles");
    expect(disclosure).toHaveTextContent("Edited linked inflows1");
    expect(disclosure).toHaveTextContent("Recorded inflows3 (2 linked to a pay schedule, 1 other)");
    expect(disclosure).toHaveTextContent("not an account balance");
  });
  it.each([
    ["10000", "0", "10000", "0", "10000"],
    ["10000", "10000", "0", "0", "10000"],
    ["0", "0", "0", "10000", "-10000"],
    ["0", "0", "0", "0", "0"],
  ])("truthfully presents cash in %s linked %s other %s and spent %s", (cashInMinor, paycheckCashInMinor, otherCashInMinor, spentMinor, netMinor) => {
    render(<CashFlowSummary data={cashFlowFixture("2026-08", { cashInMinor, paycheckCashInMinor, otherCashInMinor, spentMinor, netMinor })} />);
    expect(screen.queryByText("No deposits recorded") !== null).toBe(cashInMinor === "0");
    expect(screen.queryByText("No spending recorded") !== null).toBe(spentMinor === "0");
    if (cashInMinor === "0") expect(screen.getAllByText("Not applicable: no deposits recorded")).toHaveLength(3);
    expect(screen.queryByText(/missing income/i)).not.toBeInTheDocument();
  });
});
