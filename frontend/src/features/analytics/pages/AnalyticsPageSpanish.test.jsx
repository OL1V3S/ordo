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
    expect(screen.getByRole("heading", { level: 1, name: "Reportes" })).toBeInTheDocument();
    expect(screen.getByText("Mira tus depósitos y gastos, mes por mes.")).toBeInTheDocument();
    const selector = screen.getByLabelText("Mes");
    expect(selector).toHaveValue("2026-08");
    expect(within(selector).getAllByRole("option").map(({ value, textContent }) => [value, textContent]))
      .toEqual([["2026-08", "agosto de 2026"], ["2026-07", "julio de 2026"]]);
    expect(useBudgetLimits).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Mes")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mes anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeInTheDocument();
    expect(screen.getByText("Estado de los presupuestos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir presupuestos" })).toHaveAttribute("href", "/budgets");
    expect(screen.getByRole("button", { name: "Actualizar depósitos y gastos" })).toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Depósitos y gastos que registraste" }).closest("section");
    expect(summary).toHaveTextContent("agosto de 2026");
    expect(summary).toHaveTextContent("Hasta el 14 de agosto de 2026");
    expect(summary).toHaveTextContent("USD 100.00");
    const rows = within(screen.getByRole("heading", { name: "Dónde se gastó" }).closest("section")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Comida");
    expect(rows[0]).not.toHaveTextContent("Food");
    expect(rows[0]).toHaveTextContent("USD 90.00 · 90.0%");
    expect(screen.getByTestId("cash-flow-chart")).toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh deposits and spending")).not.toBeInTheDocument();
  });

  it("follows the selected month and a language change at runtime", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-07" } });
    expect(useCashFlow).toHaveBeenLastCalledWith("2026-07");
    const summary = screen.getByRole("heading", { name: "Depósitos y gastos que registraste" }).closest("section");
    expect(summary).toHaveTextContent("julio de 2026");
    expect(summary).not.toHaveTextContent("Hasta el");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Month")).getAllByRole("option").map(({ textContent }) => textContent))
      .toEqual(["August 2026", "July 2026"]);
    expect(screen.getByRole("heading", { name: "Deposits and spending you recorded" }).closest("section")).toHaveTextContent("July 2026");
  });

  it("renders month comparison with the previous month name, and largest expenses", () => {
    renderPage();
    const comparison = openDetail("Cambio respecto al mes anterior");
    expect(comparison).toHaveTextContent("Comparado con julio de 2026");
    expect(comparison).toHaveTextContent("+USD 25.00");
    expect(comparison).toHaveTextContent("Mayores aumentos");
    expect(comparison).toHaveTextContent("Mayores disminuciones");
    expect(comparison).toHaveTextContent("+33.3% desde USD 75.00");
    expect(comparison).toHaveTextContent("Comida");
    expect(comparison).toHaveTextContent("Transporte");
    expect(comparison).toHaveTextContent("Servicios");
    expect(comparison).not.toHaveTextContent(/Food|Transport\b|Bills/);

    const largest = openDetail("Gastos más grandes");
    expect(largest).toHaveTextContent("Los cinco principales");
    expect(largest).toHaveTextContent("Groceries");
    expect(largest).toHaveTextContent("Comida");
    expect(largest).not.toHaveTextContent("Food");
    expect(within(largest).getByRole("link", { name: "Ver movimientos" })).toHaveAttribute("href", "/transactions");
  });

  it("localizes known and uncategorized keys in comparison and largest expenses while a custom category shows as before", () => {
    useExpenses.mockReturnValue({
      expenses: [
        { id: 1, description: "Fix roof", category: "home repair", amount: 300, date: "2026-08-02" },
        { id: 2, description: "Misc", category: "uncategorized", amount: 200, date: "2026-08-03" },
        { id: 3, description: "Show", category: "entertainment", amount: 100, date: "2026-08-04" },
      ],
      loading: false, error: null, refresh: refreshExpenses,
    });
    renderPage();
    const comparison = openDetail("Cambio respecto al mes anterior");
    expect(comparison).toHaveTextContent("Home Repair");
    expect(comparison).toHaveTextContent("Sin categoría");
    expect(comparison).toHaveTextContent("Entretenimiento");
    const largest = openDetail("Gastos más grandes");
    expect(largest).toHaveTextContent("Home Repair");
    expect(largest).toHaveTextContent("Sin categoría");
    expect(largest).toHaveTextContent("Entretenimiento");
    expect(largest).not.toHaveTextContent(/Uncategorized|Entertainment/);
  });

  it("labels the comparison month as the Spanish name of the previous month across a year boundary", () => {
    useCashFlow.mockImplementation((month) => loadedCashFlow(month));
    vi.setSystemTime(new Date(2026, 0, 14, 12, 0, 0));
    renderPage();
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-01" } });
    expect(openDetail("Cambio respecto al mes anterior")).toHaveTextContent("Comparado con diciembre de 2025");
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
    expect(screen.getByText("Los montos exactos de algunos gastos no están disponibles, así que no se pueden mostrar algunas comparaciones."))
      .toBeInTheDocument();
    expect(openDetail("Cambio respecto al mes anterior")).toHaveTextContent("La comparación exacta con el mes anterior no está disponible.");
    expect(screen.queryByText("Ninguno de los dos meses tiene gastos registrados.")).not.toBeInTheDocument();
    const largest = openDetail("Gastos más grandes");
    expect(largest).toHaveTextContent("El orden exacto de tus gastos más grandes no está disponible porque no pudimos verificar un monto.");
    expect(largest).not.toHaveTextContent("No hay gastos para mostrar este mes.");
  });

  it("shows honest Spanish empty states for a month without expenses or limits", () => {
    const empty = cashFlowFixture("2026-08", { cashInMinor: "0", paycheckCashInMinor: "0", otherCashInMinor: "0", spentMinor: "0", netMinor: "0" });
    empty.categories = [];
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", { data: empty }));
    useExpenses.mockReturnValue({ expenses: [], loading: false, error: null, refresh: refreshExpenses });
    renderPage();
    expect(openDetail("Cambio respecto al mes anterior")).toHaveTextContent("USD 0.00");
    openDetail("Gastos más grandes");
    expect(screen.getAllByText("No hay gastos registrados").length).toBeGreaterThan(0);
    expect(screen.getByText("No hay depósitos registrados")).toBeInTheDocument();
    expect(screen.getByText("No hay cambios de categoría para mostrar entre estos meses.")).toBeInTheDocument();
    expect(screen.getByText("No hay gastos para mostrar este mes.")).toBeInTheDocument();
    expect(screen.getByText("Ninguno de los dos meses tiene gastos registrados.")).toBeInTheDocument();
  });

  it("renders the cash-flow loading and retryable error states in Spanish", () => {
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", { data: null, loading: true }));
    const { rerender } = renderPage();
    expect(screen.getByRole("region", { name: "Depósitos y gastos" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Cargando depósitos y gastos…")).toHaveAttribute("role", "status");
    useCashFlow.mockReturnValue(loadedCashFlow("2026-08", {
      data: null, error: i18n.t("cashFlow.errors.loadFailed", { ns: "analytics" }),
    }));
    rerender(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los depósitos y gastos. Inténtalo de nuevo.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar cargar los depósitos y gastos de nuevo" }));
    expect(refreshCashFlow).toHaveBeenCalledOnce();
  });

  it("renders the spending loading and error states in Spanish in the status area", () => {
    useExpenses.mockReturnValue({ expenses: [], loading: true, error: null, refresh: refreshExpenses });
    const { rerender } = renderPage();
    expect(screen.getByText("Cargando el reporte de gastos…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Más detalle de gastos" })).toBeInTheDocument();

    useExpenses.mockReturnValue({ expenses: [], loading: false, error: new Error("failed"), refresh: refreshExpenses });
    rerender(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los gastos registrados.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(refreshExpenses).toHaveBeenCalledOnce();
    expect(useBudgetLimits).not.toHaveBeenCalled();
  });

  it("localizes the unavailable-amount label passed to the exact-money helpers", () => {
    expect(i18n.t("format.amountUnavailable", { ns: "analytics" })).toBe("Monto exacto no disponible");
    expect(i18n.t("format.amountUnavailable", { ns: "analytics", lng: "en" })).toBe("Exact amount unavailable");
  });
});
