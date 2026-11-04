import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CashFlowCategories from "./CashFlowCategories";
import { cashFlowFixture } from "../testFixtures";

let renderedDonut;
let donutCount = 0;
vi.mock("react-chartjs-2", () => ({
  Doughnut: (props) => { renderedDonut = props; donutCount += 1; return <canvas data-testid="donut-canvas" />; },
}));

describe("cash-flow category ranking", () => {
  it("uses unique accessible headings and keeps a zero spending denominator honest", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "0" });
    data.categories = [{ category: "food", amountMinor: "1" }];

    render(<><CashFlowCategories data={data} /><CashFlowCategories data={data} /></>);

    const regions = screen.getAllByRole("region", { name: "Where it went" });
    expect(regions).toHaveLength(2);
    expect(regions[0]).not.toHaveAttribute("aria-labelledby", regions[1].getAttribute("aria-labelledby"));
    regions.forEach((region) => {
      const heading = within(region).getByRole("heading", { level: 2, name: "Where it went" });
      expect(region).toHaveAttribute("aria-labelledby", heading.id);
      expect(within(region).getByRole("listitem")).toHaveTextContent("Food$0.01 · Not applicable");
      expect(region.querySelector(".analytics-bar > span")).toHaveStyle({ width: "0%" });
    });
  });

  it("renders a hidden donut before the complete list", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "30000" });
    data.categories = [{ category: "food", amountMinor: "10000" }, { category: "rent", amountMinor: "20000" }];
    render(<CashFlowCategories data={data} />);
    const canvas = screen.getByTestId("donut-canvas");
    expect(canvas.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(canvas.compareDocumentPosition(screen.getByRole("list"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(renderedDonut.data.datasets[0].data).toEqual([20000, 10000]);
    expect(renderedDonut.options.animation).toBe(false);
    expect(renderedDonut.options.plugins.tooltip.callbacks.label({ dataIndex: 0 })).toMatch(/\$200\.00 · 66\.7%/);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("renders a single category as one full slice", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "500" });
    data.categories = [{ category: "food", amountMinor: "500" }];
    render(<CashFlowCategories data={data} />);
    expect(renderedDonut.data.datasets[0].data).toEqual([500]);
    expect(renderedDonut.options.plugins.tooltip.callbacks.label({ dataIndex: 0 })).toMatch(/100\.0%/);
  });
  it("groups beyond six categories into Other while the list stays complete", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "2800" });
    data.categories = [700, 600, 500, 400, 300, 200, 100].map((amount, index) => ({ category: `cat${index}`, amountMinor: String(amount) }));
    render(<CashFlowCategories data={data} />);
    expect(renderedDonut.data.labels).toHaveLength(6);
    expect(renderedDonut.data.labels[5]).toBe("Other (2)");
    expect(renderedDonut.data.datasets[0].data).toEqual([700, 600, 500, 400, 300, 200 + 100]);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });
  it("renders no donut for a month without spending", () => {
    donutCount = 0;
    render(<CashFlowCategories data={{ ...cashFlowFixture("2026-08"), categories: [] }} />);
    expect(screen.getByText("No spending recorded")).toBeInTheDocument();
    expect(donutCount).toBe(0);
  });
});
