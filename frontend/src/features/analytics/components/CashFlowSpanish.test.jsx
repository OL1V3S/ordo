import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CashFlowCategories from "./CashFlowCategories";
import CashFlowSummary from "./CashFlowSummary";
import CashFlowTrendChart from "./CashFlowTrendChart";
import i18n from "../../../shared/localization/i18n";
import { cashFlowFixture } from "../testFixtures";

let renderedChart;
vi.mock("react-chartjs-2", () => ({
  Bar: (props) => { renderedChart = props; return <canvas data-testid="trend-canvas" />; },
}));

describe("cash-flow components in Spanish", () => {
  beforeEach(async () => { await i18n.changeLanguage("es"); });
  afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  it("renders the summary with recorded cash in and spending kept distinct and the month names localized", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "30000", netMinor: "-15000" });
    render(<CashFlowSummary data={data} />);
    const card = screen.getByRole("region", { name: "Entradas de dinero registradas vs. gastado" });
    expect(card).toHaveTextContent("agosto de 2026");
    expect(card).toHaveTextContent("Hasta el 14 de agosto de 2026");
    expect(card).toHaveTextContent("Basado en tus transacciones registradas.");
    expect(card).toHaveTextContent("Entradas de dinero registradasUSD 150.00");
    expect(card).toHaveTextContent("GastadoUSD 300.00");
    expect(within(card).getByRole("heading", { name: "Flujo de efectivo neto registrado" })).toBeInTheDocument();
    expect(card).toHaveTextContent("−USD 150.00");
    expect(card).toHaveTextContent("Entradas de dinero registradas menos gastado");
    const breakdown = screen.getByRole("list", { name: "Desglose de las entradas de dinero registradas" });
    expect(breakdown).toHaveTextContent("Pagos de nómina confirmados USD 120.00");
    expect(breakdown).toHaveTextContent("Otras entradas de dinero USD 30.00");
    expect(screen.queryByText(/Through|Recorded cash in|Spent/)).not.toBeInTheDocument();
  });

  it("keeps the explanatory disclosure and its counts in Spanish without calling an expectation recorded", () => {
    render(<CashFlowSummary data={cashFlowFixture("2026-08", { editedPaycheckInflowCount: 1 })} />);
    const disclosure = screen.getByText("Acerca de estas cifras").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("no es un saldo de la cuenta, ahorros ni dinero disponible para gastar");
    expect(disclosure).toHaveTextContent("incluidos los perfiles activos, en pausa y finalizados");
    expect(disclosure).toHaveTextContent("recibir dinero no lo clasifica como ingreso");
    expect(disclosure).toHaveTextContent("las previsiones de nómina, las proyecciones y las vistas previas de importación sin guardar no se suman a estas cifras");
    expect(disclosure).toHaveTextContent("Entradas de dinero gastadas66.7%");
    expect(disclosure).toHaveTextContent("Entradas registradas3 (vinculadas a nómina: 2, otras: 1)");
    expect(disclosure).toHaveTextContent("Gastos registrados2");
    expect(disclosure).toHaveTextContent("Perfiles de nómina que contribuyen1");
    expect(disclosure).toHaveTextContent("Entradas vinculadas editadas1");
    expect(disclosure).toHaveTextContent("los porcentajes redondeados no sumen 100.0%");
  });

  it("omits the through-date note for a past month and shows it as a Spanish month label", () => {
    render(<CashFlowSummary data={{ ...cashFlowFixture("2026-07"), throughDate: "2026-08-14" }} />);
    const card = screen.getByRole("region", { name: "Entradas de dinero registradas vs. gastado" });
    expect(card).toHaveTextContent("julio de 2026");
    expect(card).not.toHaveTextContent("Hasta el");
  });

  it("states a recorded zero in Spanish and marks percentages not applicable without cash in", () => {
    render(<CashFlowSummary data={cashFlowFixture("2026-08", {
      cashInMinor: "0", paycheckCashInMinor: "0", otherCashInMinor: "0", spentMinor: "0", netMinor: "0",
    })} />);
    expect(screen.getByText("No hay entradas de dinero registradas")).toBeInTheDocument();
    expect(screen.getByText("No hay gastos registrados")).toBeInTheDocument();
    expect(screen.getAllByText("No aplica — no hay entradas de dinero registradas")).toHaveLength(3);
    expect(screen.queryByText(/not available|no disponible/i)).not.toBeInTheDocument();
  });

  it("renders the category ranking and its empty state in Spanish with stored category names as stored", () => {
    const data = cashFlowFixture("2026-08", { spentMinor: "0" });
    data.categories = [{ category: "food", amountMinor: "1" }];
    const { unmount } = render(<CashFlowCategories data={data} />);
    const region = screen.getByRole("region", { name: "Dónde se gastó" });
    expect(region).toHaveTextContent("Ordenado por monto");
    expect(within(region).getByRole("listitem")).toHaveTextContent("FoodUSD 0.01 · No aplica");
    unmount();
    render(<CashFlowCategories data={{ ...data, categories: [] }} />);
    expect(screen.getByText("No hay gastos registrados")).toBeInTheDocument();
  });

  it("gives the chart Spanish dataset labels, month ticks, tooltips, and axis, with the currency code unchanged", () => {
    render(<CashFlowTrendChart data={cashFlowFixture()} />);
    expect(renderedChart.data.labels).toEqual([
      ["mar", "2026"], ["abr", "2026"], ["may", "2026"], ["jun", "2026"], ["jul", "2026"], ["ago", "2026", "Acum."],
    ]);
    expect(renderedChart.data.datasets.map(({ label }) => label))
      .toEqual(["Pagos de nómina confirmados", "Otras entradas de dinero", "Gastado"]);
    expect(renderedChart.data.datasets.map(({ data }) => data[5])).toEqual([120, 30, 100]);
    expect(renderedChart.options.scales.y.title.text).toBe("USD");
    const callbacks = renderedChart.options.plugins.tooltip.callbacks;
    expect(callbacks.title([{ dataIndex: 4 }])).toBe("julio de 2026");
    expect(callbacks.title([{ dataIndex: 5 }])).toBe("agosto de 2026");
    expect(callbacks.title([])).toBe("");
    expect(callbacks.label({ dataset: renderedChart.data.datasets[1], datasetIndex: 1, dataIndex: 5 }))
      .toBe("Otras entradas de dinero: USD\u00a030.00");
    expect(callbacks.footer([{ dataIndex: 5 }])).toBe("Entradas de dinero registradas: USD\u00a0150.00");
  });

  it("keeps tooltip amounts exact from the cash-flow strings in Spanish", () => {
    const data = cashFlowFixture("2026-08", { cashInMinor: "999999999999999999", otherCashInMinor: "999999999999999999", paycheckCashInMinor: "0" });
    render(<CashFlowTrendChart data={data} />);
    const callbacks = renderedChart.options.plugins.tooltip.callbacks;
    expect(callbacks.label({ dataset: renderedChart.data.datasets[1], datasetIndex: 1, dataIndex: 5 }))
      .toBe("Otras entradas de dinero: USD\u00a09,999,999,999,999,999.99");
    expect(callbacks.footer([{ dataIndex: 5 }])).toBe("Entradas de dinero registradas: USD\u00a09,999,999,999,999,999.99");
  });

  it("renders the chart heading, legend, month-to-date note, kicker, and accessible table in Spanish", () => {
    render(<CashFlowTrendChart data={cashFlowFixture()} />);
    const region = screen.getByRole("region", { name: "Entradas de dinero vs. gastos a lo largo del tiempo" });
    expect(region).toHaveTextContent("Seis meses calendario");
    expect(within(region).getByRole("list", { name: "Leyenda del gráfico" })).toHaveTextContent("Pagos de nómina confirmadosOtras entradas de dineroGastado");
    expect(screen.getByText("Acum.: acumulado del mes hasta la fecha")).toBeInTheDocument();
    const disclosure = screen.getByText("Ver datos del gráfico").closest("details");
    const table = within(disclosure).getByRole("table", { hidden: true });
    expect(within(table).getByText("Flujo de efectivo mensual registrado en dólares estadounidenses")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row", { hidden: true });
    expect(rows[0]).toHaveTextContent("MesEntradas de dinero registradasPagos de nómina confirmadosOtras entradas de dineroGastadoFlujo de efectivo neto registradoNota del período");
    expect(rows[1]).toHaveTextContent("marzo de 2026USD 0.00USD 0.00USD 0.00USD 0.00USD 0.00No hay entradas de dinero registradas · No hay gastos registrados");
    expect(rows[6]).toHaveTextContent("agosto de 2026USD 150.00USD 120.00USD 30.00USD 100.00+USD 50.00Hasta el 14 de agosto de 2026");
  });

  it("uses count-aware Spanish kickers at the representable-calendar floor", () => {
    const data = cashFlowFixture();
    const bucket = (month, to) => ({ ...data.selected, month, from: `${month}-01`, to });
    data.months = [bucket("0001-01", "0001-01-31")];
    const { unmount } = render(<CashFlowTrendChart data={data} />);
    expect(screen.getByText("1 mes calendario desde enero de 0001")).toBeInTheDocument();
    expect(renderedChart.data.labels).toEqual([["ene", "0001"]]);
    unmount();
    data.months = [bucket("0001-01", "0001-01-31"), bucket("0001-02", "0001-02-28")];
    render(<CashFlowTrendChart data={data} />);
    expect(screen.getByText("2 meses calendario desde enero de 0001")).toBeInTheDocument();
  });

  it("follows a language change at runtime and keeps the English count-aware kicker", async () => {
    const data = cashFlowFixture();
    data.months = [{ ...data.selected, month: "0001-01", from: "0001-01-01", to: "0001-01-31" }, { ...data.selected, month: "0001-02", from: "0001-02-01", to: "0001-02-28" }];
    render(<CashFlowTrendChart data={data} />);
    expect(screen.getByText("2 meses calendario desde enero de 0001")).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByText("2 calendar months from January 0001")).toBeInTheDocument();
    expect(renderedChart.data.labels).toEqual([["Jan", "0001"], ["Feb", "0001"]]);
  });
});
