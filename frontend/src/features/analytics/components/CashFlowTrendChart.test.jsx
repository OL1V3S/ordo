import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CashFlowTrendChart from "./CashFlowTrendChart";
import { cashFlowFixture } from "../testFixtures";

let renderedChart;
vi.mock("react-chartjs-2", () => ({
  Bar: (props) => { renderedChart = props; return <canvas data-testid="trend-canvas" />; },
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); });

describe("cash-flow monthly grouped stacks", () => {
  it("has six explicit monthly groups with the two cash-in datasets sharing a stack and no animations", () => {
    render(<CashFlowTrendChart data={cashFlowFixture()} />);
    expect(renderedChart.data.labels).toEqual([
      ["Mar", "2026"], ["Apr", "2026"], ["May", "2026"], ["Jun", "2026"], ["Jul", "2026"], ["Aug", "2026", "MTD"],
    ]);
    expect(renderedChart.data.datasets).toMatchObject([
      { label: "Confirmed paychecks", stack: "cash-in", data: [0, 0, 0, 0, 0, 120], borderWidth: 1 },
      { label: "Other deposits", stack: "cash-in", data: [0, 0, 0, 0, 0, 30], borderWidth: 3 },
      { label: "Spent", stack: "spent", data: [0, 0, 0, 0, 0, 100], borderWidth: 1 },
    ]);
    expect(renderedChart.options.animation).toBe(false);
    expect(renderedChart.options.scales.y).toMatchObject({ stacked: true, beginAtZero: true });
    expect(renderedChart.options.scales.x.ticks.autoSkip).toBe(false);
    expect(screen.getByTestId("trend-canvas").parentElement).toHaveAttribute("aria-hidden", "true");
  });
  it("provides exact complete table data without hovering, including all empty buckets and period notes", () => {
    render(<CashFlowTrendChart data={cashFlowFixture()} />);
    const disclosure = screen.getByText("View chart data").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    const table = within(disclosure).getByRole("table", { hidden: true });
    const rows = within(table).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("Recorded cash inConfirmed paychecksOther cash inSpentNet recorded cash flowPeriod note");
    expect(rows[1]).toHaveTextContent("No cash in recorded · No spending recorded");
    expect(rows[6]).toHaveTextContent("August 2026$150.00$120.00$30.00$100.00+$50.00Through August 14, 2026");
    expect(table.parentElement).toHaveAttribute("tabindex", "0");
  });
  it("formats tooltip values from exact strings instead of rounded chart numbers", () => {
    const data = cashFlowFixture("2026-08", { cashInMinor: "999999999999999999", otherCashInMinor: "999999999999999999", paycheckCashInMinor: "0" });
    render(<CashFlowTrendChart data={data} />);
    const callbacks = renderedChart.options.plugins.tooltip.callbacks;
    expect(callbacks.label({ dataset: { label: "Other deposits" }, datasetIndex: 1, dataIndex: 5 }))
      .toBe("Other cash in: $9,999,999,999,999,999.99");
    expect(callbacks.footer([{ dataIndex: 5 }])).toBe("Deposits: $9,999,999,999,999,999.99");
  });
  it("labels a shorter representable-calendar-floor range", () => {
    const data = cashFlowFixture();
    data.months = [{ ...data.selected, month: "0001-01", from: "0001-01-01", to: "0001-01-31" }];
    render(<CashFlowTrendChart data={data} />);
    expect(screen.getByText("1 calendar month from January 0001")).toBeInTheDocument();
    expect(renderedChart.data.labels).toEqual([["Jan", "0001"]]);
  });
  it("updates light/dark/system palette and removes theme listeners without changing data", async () => {
    const listeners = new Set();
    let systemDark = false;
    const query = { addEventListener: vi.fn((_, listener) => listeners.add(listener)), removeEventListener: vi.fn((_, listener) => listeners.delete(listener)) };
    vi.stubGlobal("matchMedia", vi.fn(() => query));
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: (name) => name === "--chart-paychecks" ? ((document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && systemDark)) ? "#69c5b1" : "#24776a") : "",
    }));
    const { unmount } = render(<CashFlowTrendChart data={cashFlowFixture()} />);
    await waitFor(() => expect(renderedChart.data.datasets[0].backgroundColor).toBe("#24776a"));
    const before = renderedChart.data.datasets.map(({ data }) => data);
    act(() => { document.documentElement.dataset.theme = "dark"; });
    await waitFor(() => expect(renderedChart.data.datasets[0].backgroundColor).toBe("#69c5b1"));
    act(() => { document.documentElement.removeAttribute("data-theme"); systemDark = false; listeners.forEach((listener) => listener()); });
    await waitFor(() => expect(renderedChart.data.datasets[0].backgroundColor).toBe("#24776a"));
    act(() => { systemDark = true; listeners.forEach((listener) => listener()); });
    await waitFor(() => expect(renderedChart.data.datasets[0].backgroundColor).toBe("#69c5b1"));
    expect(renderedChart.data.datasets.map(({ data }) => data)).toEqual(before);
    unmount();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(listeners.size).toBe(0);
  });
});
