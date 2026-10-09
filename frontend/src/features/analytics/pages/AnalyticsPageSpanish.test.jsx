import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./AnalyticsPage";
import i18n from "../../../shared/localization/i18n";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { useBudgetLimits } from "../../budgetLimits/hooks/useBudgetLimits";
import { useCashFlow } from "../hooks/useCashFlow";
import { cashFlowFixture } from "../testFixtures";

vi.mock("../hooks/useCashFlow", () => ({ useCashFlow: vi.fn() }));
vi.mock("react-chartjs-2", () => ({ Bar: () => <canvas data-testid="cash-flow-chart" /> }));
vi.mock("../../expenses/hooks/useExpenses", () => ({ useExpenses: vi.fn() }));
vi.mock("../../budgetLimits/hooks/useBudgetLimits", () => ({ useBudgetLimits: vi.fn() }));

const refreshExpenses = vi.fn();
const refreshCashFlow = vi.fn();

function loadedCashFlow(month = "2026-08", overrides = {}) {
  const data = cashFlowFixture(month, month === "2026-07" ? { spentMinor: "7500", netMinor: "7500" } : {});
  if (month === "2026-07") data.categories = [{ category: "bills", amountMinor: "7500" }];
  return { data, loading: false, error: null, availableMonths: data.availableMonths, refresh: refreshCashFlow, ...overrides };
}

function renderPage() {
  return render(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
}

function openDetail(name) {
  const button = within(screen.getByRole("heading", { level: 3, name })).getByRole("button");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  return document.getElementById(button.getAttribute("aria-controls"));
}

describe("Analytics page in Spanish", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0));
    useCashFlow.mockImplementation((month) => loadedCashFlow(month));
    useExpenses.mockReturnValue({
      expenses: [
        { id: 1, description: "Groceries", category: "food", amount: 90, date: "2026-08-02" },
        { id: 2, description: "Train", category: "transport", amount: 10, date: "2026-08-03" },
        { id: 3, description: "Rent", category: "bills", amount: 75, date: "2026-07-02" },
      ],
      loading: false, error: null, refresh: refreshExpenses,
    });
    await i18n.changeLanguage("es");
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("renders the header, month selector with Spanish month names, summary, and categories", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Análisis" })).toBeInTheDocument();
    expect(screen.getByText("Mira las entradas de dinero y los gastos registrados, mes por mes.")).toBeInTheDocument();
    const selector = screen.getByLabelText("Mes");
    expect(selector).toHaveValue("2026-08");
    expect(within(selector).getAllByRole("option").map(({ value, textContent }) => [value, textContent]))
      .toEqual([["2026-08", "agosto de 2026"], ["2026-07", "julio de 2026"]]);
    expect(useBudgetLimits).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Mes")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mes anterior con datos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mes siguiente con datos" })).toBeInTheDocument();
    expect(screen.getByText("Estado de los presupuestos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir presupuestos" })).toHaveAttribute("href", "/budgets");
    expect(screen.getByRole("button", { name: "Actualizar flujo de efectivo" })).toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Entradas de dinero registradas vs. gastado" }).closest("section");
    expect(summary).toHaveTextContent("agosto de 2026");
    expect(summary).toHaveTextContent("Hasta el 14 de agosto de 2026");
    expect(summary).toHaveTextContent("$100.00");
    const rows = within(screen.getByRole("heading", { name: "Dónde se gastó" }).closest("section")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Food");
    expect(rows[0]).toHaveTextContent("$90.00 · 90.0%");
    expect(screen.getByTestId("cash-flow-chart")).toBeInTheDocument();
    expect(screen.queryByText("Insights")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh cash flow")).not.toBeInTheDocument();
  });

  it("follows the selected month and a language change at runtime", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-07" } });
    expect(useCashFlow).toHaveBeenLastCalledWith("2026-07");
    const summary = screen.getByRole("heading", { name: "Entradas de dinero registradas vs. gastado" }).closest("section");
    expect(summary).toHaveTextContent("julio de 2026");
    expect(summary).not.toHaveTextContent("Hasta el");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByRole("heading", { level: 1, name: "Insights" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Month")).getAllByRole("option").map(({ textContent }) => textContent))
      .toEqual(["August 2026", "July 2026"]);
    expect(screen.getByRole("heading", { name: "Recorded cash in vs Spent" }).closest("section")).toHaveTextContent("July 2026");
  });

  it("renders month comparison with the previous month name, and largest expenses", () => {
    renderPage();
    const comparison = openDetail("Cambio de un mes a otro");
    expect(comparison).toHaveTextContent("Comparado con julio de 2026");
    expect(comparison).toHaveTextContent("+$25.00");
    expect(comparison).toHaveTextContent("Mayores aumentos");
    expect(comparison).toHaveTextContent("Mayores disminuciones");
    expect(comparison).toHaveTextContent("+33.3% desde $75.00");

    const largest = openDetail("Gastos más grandes");
    expect(largest).toHaveTextContent("Los cinco principales");
    expect(largest).toHaveTextContent("Groceries");
    expect(within(largest).getByRole("link", { name: "Revisar actividad" })).toHaveAttribute("href", "/transactions");
  });

  it("labels the comparison month as the Spanish name of the previous month across a year boundary", () => {
    useCashFlow.mockImplementation((month) => loadedCashFlow(month));
    vi.setSystemTime(new Date(2026, 0, 14, 12, 0, 0));
    renderPage();
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-01" } });
    expect(openDetail("Cambio de un mes a otro")).toHaveTextContent("Comparado con diciembre de 2025");
  });

  it("keeps an unavailable exact figure distinct from a recorded zero", () => {
    useExpenses.mockReturnValue({
      expenses: [
        { id: 1, description: "Ambiguous", category: "food", amount: Number("9999999999999999"), date: "2026-08-02" },
        { id: 2, description: "Known smaller", category: "food", amount: "90.00", date: "2026-08-03" },
      ],
      loading: false, error: null, refresh: refreshExpenses,
    });
    renderPage();
    expect(screen.getByText("No se pudieron verificar con exactitud algunos montos de gastos. Las comparaciones de gastos afectadas no están disponibles."))
      .toBeInTheDocument();
    expect(openDetail("Cambio de un mes a otro")).toHaveTextContent("La comparación exacta de un mes a otro no está disponible.");
    expect(screen.queryByText("Ninguno de los dos meses tiene gastos registrados.")).not.toBeInTheDocument();
    const largest = openDetail("Gastos más grandes");
    expect(largest).toHaveTextContent("La clasificación exacta de los gastos más grandes no está disponible porque no se pudo verificar un monto.");
    expect(largest).not.toHaveTextContent("No hay gastos para clasificar este mes.");
  });

  it("shows honest Spanish empty states for a month without expenses or limits", () => {
    const empty = cashFlowFixture("2026-08", { cashInMinor: "0", paycheckCashInMinor: "0", otherCashInMinor: "0", spentMinor: "0", netMinor: "0" });
    empty.categories = [];
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", { data: empty }));
    useExpenses.mockReturnValue({ expenses: [], loading: false, error: null, refresh: refreshExpenses });
    renderPage();
    expect(openDetail("Cambio de un mes a otro")).toHaveTextContent("$0.00");
    openDetail("Gastos más grandes");
    expect(screen.getAllByText("No hay gastos registrados").length).toBeGreaterThan(0);
    expect(screen.getByText("No hay entradas de dinero registradas")).toBeInTheDocument();
    expect(screen.getByText("No hay cambios de categoría para mostrar entre estos meses.")).toBeInTheDocument();
    expect(screen.getByText("No hay gastos para clasificar este mes.")).toBeInTheDocument();
    expect(screen.getByText("Ninguno de los dos meses tiene gastos registrados.")).toBeInTheDocument();
  });

  it("renders the cash-flow loading and retryable error states in Spanish", () => {
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", { data: null, loading: true }));
    const { rerender } = renderPage();
    expect(screen.getByRole("region", { name: "Flujo de efectivo registrado" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Cargando el flujo de efectivo registrado...")).toHaveAttribute("role", "status");
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", {
      data: null, error: i18n.t("cashFlow.errors.loadFailed", { ns: "analytics" }),
    }));
    rerender(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el flujo de efectivo registrado. Inténtalo de nuevo.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar flujo de efectivo" }));
    expect(refreshCashFlow).toHaveBeenCalledOnce();
  });

  it("renders the spending loading and error states in Spanish in the status area", () => {
    useExpenses.mockReturnValue({ expenses: [], loading: true, error: null, refresh: refreshExpenses });
    const { rerender } = renderPage();
    expect(screen.getByText("Cargando el análisis de gastos...")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Más detalle de gastos" })).toBeInTheDocument();

    useExpenses.mockReturnValue({ expenses: [], loading: false, error: new Error("failed"), refresh: refreshExpenses });
    rerender(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los gastos registrados.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(refreshExpenses).toHaveBeenCalledOnce();
    expect(useBudgetLimits).not.toHaveBeenCalled();
  });
});
