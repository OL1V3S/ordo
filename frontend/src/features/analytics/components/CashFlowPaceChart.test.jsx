import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CashFlowPaceChart from "./CashFlowPaceChart";
import { cashFlowFixture } from "../testFixtures";

let renderedChart;
vi.mock("react-chartjs-2", () => ({
  Line: (props) => { renderedChart = props; return <canvas data-testid="pace-canvas" />; },
}));

function withPrevious(data, days) {
  const months = data.months.map((bucket, index) => index === data.months.length - 2 ? { ...bucket, days } : bucket);
  return { ...data, months };
}
const julyDays = (spent) => Array.from({ length: 31 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, "0")}`, spentMinor: spent[index + 1] ?? "0" }));

describe("daily spending pace chart", () => {
  it("plots the month so far solid and the previous month dashed, without animation", () => {
    const data = withPrevious(cashFlowFixture(), julyDays({ 20: "500", 31: "700" }));
    render(<CashFlowPaceChart data={data} />);
    expect(renderedChart.data.labels).toHaveLength(31);
    const [current, previous] = renderedChart.data.datasets;
    expect(current.label).toBe("August 2026");
    expect(current.data).toHaveLength(14);
    expect(current.data.slice(0, 4)).toEqual([0, 0, 10, 10]);
    expect(current.data[13]).toBe(100);
    expect(current.borderDash).toEqual([]);
    expect(previous.label).toBe("July 2026");
    expect(previous.borderDash).toEqual([6, 4]);
    expect(previous.data[30]).toBe(12);
    expect(renderedChart.options.animation).toBe(false);
    expect(renderedChart.options.scales.y.beginAtZero).toBe(true);
    expect(screen.getByTestId("pace-canvas").parentElement).toHaveAttribute("aria-hidden", "true");
  });
  it("omits the previous line at the representable-calendar floor", () => {
    const data = cashFlowFixture();
    data.months = [data.selected];
    render(<CashFlowPaceChart data={data} />);
    expect(renderedChart.data.datasets).toHaveLength(1);
    expect(renderedChart.data.labels).toHaveLength(14);
  });
  it("resolves tooltip title and label from the hovered dataset, including a day only the previous month has", () => {
    const data = withPrevious(cashFlowFixture(), julyDays({ 31: "700" }));
    render(<CashFlowPaceChart data={data} />);
    const callbacks = renderedChart.options.plugins.tooltip.callbacks;
    expect(callbacks.title([{ datasetIndex: 0, dataIndex: 9 }])).toBe("August 10, 2026");
    expect(callbacks.label({ datasetIndex: 0, dataIndex: 9 })).toBe("August 2026: $90.00 that day, $100.00 so far");
    expect(callbacks.title([{ datasetIndex: 1, dataIndex: 30 }])).toBe("July 31, 2026");
    expect(callbacks.label({ datasetIndex: 1, dataIndex: 30 })).toBe("July 2026: $7.00 that day, $7.00 so far");
    expect(callbacks.title([])).toBe("");
  });
  it("keeps exact amounts above 2^53 in the tooltip and table", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "999999999999999999" });
    render(<CashFlowPaceChart data={data} />);
    expect(renderedChart.options.plugins.tooltip.callbacks.label({ datasetIndex: 0, dataIndex: 9 }))
      .toContain("$9,999,999,999,999,999.99 so far");
  });
  it("lists days with spending and a total row equal to Spent in the table", () => {
    render(<CashFlowPaceChart data={cashFlowFixture()} />);
    const table = within(screen.getByText("View chart data").closest("details")).getByRole("table", { hidden: true });
    const rows = within(table).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("DateSpent that daySpent so far");
    expect(rows[1]).toHaveTextContent("August 3, 2026$10.00$10.00");
    expect(rows[2]).toHaveTextContent("August 10, 2026$90.00$100.00");
    expect(rows[3]).toHaveTextContent("Spent$100.00");
  });
  it("shows the empty state, never an error, when days are missing or nothing was spent", () => {
    const missing = cashFlowFixture();
    delete missing.selected.days;
    const { unmount } = render(<CashFlowPaceChart data={missing} />);
    expect(screen.getByText("No daily spending to show")).toBeInTheDocument();
    unmount();
    render(<CashFlowPaceChart data={cashFlowFixture("2026-08", { spentMinor: "0" })} />);
    expect(screen.getByText("No daily spending to show")).toBeInTheDocument();
  });
});
