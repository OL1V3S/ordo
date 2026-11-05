import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CashFlowCategoryTrendChart from "./CashFlowCategoryTrendChart";
import { cashFlowFixture } from "../testFixtures";

let renderedChart;
vi.mock("react-chartjs-2", () => ({
  Bar: (props) => { renderedChart = props; return <canvas data-testid="stack-canvas" />; },
}));

function sevenCategories() {
  const data = cashFlowFixture("2026-08", { spentMinor: "2800" });
  const rows = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((category, index) => ({ category, amountMinor: String((7 - index) * 100) }));
  data.selected = { ...data.selected, categories: rows };
  data.months = data.months.map((bucket) => bucket.month === "2026-08" ? data.selected : bucket);
  return data;
}

describe("category trend chart", () => {
  it("stacks the categories so each month sums to its Spent, in donut palette order", () => {
    const data = cashFlowFixture();
    render(<CashFlowCategoryTrendChart data={data} />);
    expect(renderedChart.data.datasets.map((set) => set.label)).toEqual(["Food", "Transport"]);
    expect(renderedChart.data.datasets.map((set) => set.backgroundColor)).toEqual(["#24776a", "#9b6525"]);
    expect(renderedChart.data.datasets[0].data).toEqual([0, 0, 0, 0, 0, 90]);
    renderedChart.data.datasets[0].data.forEach((value, index) => {
      const total = renderedChart.data.datasets.reduce((sum, set) => sum + set.data[index], 0);
      expect(total).toBe(Number(data.months[index].spentMinor) / 100);
    });
    expect(renderedChart.options.animation).toBe(false);
    expect(renderedChart.options.scales.y.stacked).toBe(true);
    expect(screen.getByTestId("stack-canvas").parentElement).toHaveAttribute("aria-hidden", "true");
  });
  it("keeps five categories and groups the other two into Other", () => {
    render(<CashFlowCategoryTrendChart data={sevenCategories()} />);
    const labels = renderedChart.data.datasets.map((set) => set.label);
    expect(labels).toHaveLength(6);
    expect(labels[5]).toBe("Other (2)");
    expect(renderedChart.data.datasets[5].data[5]).toBe(3);
    expect(renderedChart.data.datasets[5].backgroundColor).toBe("#666873");
  });
  it("uses exact strings in tooltips", () => {
    render(<CashFlowCategoryTrendChart data={cashFlowFixture()} />);
    const callbacks = renderedChart.options.plugins.tooltip.callbacks;
    expect(callbacks.title([{ dataIndex: 5 }])).toBe("August 2026");
    expect(callbacks.label({ datasetIndex: 0, dataIndex: 5 })).toBe("Food: $90.00");
    expect(callbacks.footer([{ dataIndex: 5 }])).toBe("Spent: $100.00");
  });
  it("provides a table with a Spent column equal to the trend table", () => {
    render(<CashFlowCategoryTrendChart data={cashFlowFixture()} />);
    const table = within(screen.getByText("View chart data").closest("details")).getByRole("table", { hidden: true });
    const rows = within(table).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("MonthFoodTransportSpent");
    expect(rows[6]).toHaveTextContent("August 2026$90.00$10.00$100.00");
  });
  it("shows the empty state when categories are missing", () => {
    const data = cashFlowFixture();
    data.months = data.months.map((bucket) => ({ ...bucket, categories: undefined }));
    render(<CashFlowCategoryTrendChart data={data} />);
    expect(screen.getByText("No spending recorded in these months")).toBeInTheDocument();
  });
});
