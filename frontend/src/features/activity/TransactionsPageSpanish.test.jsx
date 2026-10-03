import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsPage from "../transactions/pages/TransactionsPage";
import { useExpenses } from "../expenses/hooks/useExpenses";
import { useInflows } from "../inflows/hooks/useInflows";
import { useImportPreview } from "../importPreview/hooks/useImportPreview";
import { useActivityTimeline } from "./hooks/useActivityTimeline";
import { clearSession, establishSession } from "../../shared/auth/session";
import i18n from "../../shared/localization/i18n";

vi.mock("../expenses/hooks/useExpenses", () => ({ useExpenses: vi.fn() }));
vi.mock("../inflows/hooks/useInflows", () => ({ useInflows: vi.fn() }));
vi.mock("../importPreview/hooks/useImportPreview", () => ({ useImportPreview: vi.fn() }));
vi.mock("./hooks/useActivityTimeline", () => ({ useActivityTimeline: vi.fn() }));

const idleTimeline = {
  items: [], hasMore: false, loading: false, error: false, refreshFailed: false, malformed: false,
  loadingMore: false, loadMoreFailed: false, loadMore: vi.fn(), refresh: vi.fn().mockResolvedValue({ stale: false }),
};
const idleImport = {
  preview: null, sourceType: "", loading: false, processing: false, error: "", confirming: false,
  confirmation: null, confirmationIssue: null, selectedCount: 0, selectSource: vi.fn(), upload: vi.fn(),
  cancel: vi.fn(), updateRow: vi.fn(), confirm: vi.fn(), clearForReupload: vi.fn(),
};
const lunch = { id: 42, description: "Lunch", category: "food", amount: "5.00", date: "2026-09-01" };
const oddAmount = { id: 43, description: "Odd", category: "bills", amount: "-5.00", date: "2026-09-02" };
const transfer = { id: 1, description: "Transfer from Savings", amount: 24.15, date: "2026-09-01" };
const unsafeTransfer = { id: 2, description: "Large transfer", amount: 2 ** 46, date: "2026-09-02" };
let expenses;
let cash;
let confirmSpy = null;

function renderPage() {
  return render(<I18nextProvider i18n={i18n}><TransactionsPage /></I18nextProvider>);
}
function mockLists(overrides = {}) {
  expenses = { expenses: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined),
    addExpense: vi.fn().mockResolvedValue({ refreshFailed: false }), updateExpense: vi.fn(),
    deleteExpense: vi.fn().mockResolvedValue({ refreshFailed: false }), ...overrides.expenses };
  cash = { inflows: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue({ stale: false }),
    createInflow: vi.fn().mockResolvedValue({ refreshFailed: false }), updateInflow: vi.fn(),
    deleteInflow: vi.fn().mockResolvedValue({ refreshFailed: false }), ...overrides.cash };
  useExpenses.mockImplementation(() => expenses);
  useInflows.mockImplementation(() => cash);
}
async function fillExpense(user, task, amount = "12.50") {
  await user.type(within(task).getByLabelText("Descripción"), "Synthetic meal");
  await user.type(within(task).getByLabelText("Monto"), amount);
  fireEvent.change(within(task).getByLabelText("Fecha"), { target: { value: "2026-09-01" } });
  await user.selectOptions(within(task).getByLabelText("Categoría"), "food");
}

beforeEach(async () => {
  sessionStorage.clear();
  establishSession("token", "owner@example.test");
  useActivityTimeline.mockImplementation(() => idleTimeline);
  useImportPreview.mockReturnValue({ ...idleImport });
  mockLists();
  await i18n.changeLanguage("es");
});
afterEach(async () => {
  await i18n.changeLanguage("en");
  clearSession();
  sessionStorage.clear();
  confirmSpy?.mockRestore();
  confirmSpy = null;
});

describe("Activity spending in Spanish", () => {
  it("renders the page header, actions, and section headings in Spanish", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Actividad" })).toBeInTheDocument();
    expect(screen.getByText("Revisa los gastos registrados y el dinero que entra.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar gasto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar entrada de dinero" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar estado de cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Actividad de gastos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar actividad" })).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay gastos registrados.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add expense" })).not.toBeInTheDocument();
    expect(screen.queryByText("No expenses recorded yet.")).not.toBeInTheDocument();
  });

  it("renders the expense table, row actions, and review state in Spanish without changing money or dates", () => {
    mockLists({ expenses: { expenses: [lunch, oddAmount] } });
    renderPage();

    const table = screen.getByRole("region", { name: "Tabla de gastos" });
    for (const name of ["Descripción", "Monto ($)", "Fecha", "Categoría", "Acciones"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(within(table).getByRole("cell", { name: "5.00" })).toBeInTheDocument();
    expect(within(table).getByText("09/01/2026")).toBeInTheDocument();
    expect(within(table).getByText("Food")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Editar gasto Lunch del 09/01/2026, fila 1" })).toBeEnabled();
    expect(within(table).getByRole("button", { name: "Eliminar gasto Lunch del 09/01/2026, fila 1" })).toBeEnabled();
    expect(within(table).getByText("El monto requiere revisión")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Editar gasto Odd del 09/02/2026, fila 2" })).toBeDisabled();
  });

  it("renders the expense filters and their active summary in Spanish", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { expenses: [lunch] } });
    renderPage();
    const filters = document.querySelector(".expense-filters");

    await user.type(screen.getByLabelText("Buscar gastos"), "lunch");
    expect(screen.getByPlaceholderText("Buscar por descripción o categoría...")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Rango de fechas"), "custom");
    fireEvent.change(screen.getByLabelText("Fecha de inicio"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Fecha de fin"), { target: { value: "2026-09-30" } });
    const dateOptions = within(screen.getByLabelText("Rango de fechas")).getAllByRole("option", { hidden: true });
    expect(dateOptions.map((option) => option.textContent)).toEqual(
      ["Todo el tiempo", "Últimos 7 días", "Últimos 30 días", "Este mes", "Rango personalizado"]);
    const categoryOptions = within(within(filters).getByLabelText("Categoría")).getAllByRole("option", { hidden: true });
    expect(categoryOptions.map((option) => option.textContent)).toEqual(
      ["Todas", "Comida", "Transporte", "Facturas", "Entretenimiento", "Otra"]);
    expect(screen.getByText("Filtrar por fecha o categoría")).toBeInTheDocument();

    expect(screen.getByText(/Filtros activos:/)).toBeInTheDocument();
    expect(screen.getByText(/Búsqueda: “lunch” · Rango personalizado: 2026-09-01 – 2026-09-30/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Borrar filtros" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Tabla de gastos" })).getByText("Lunch")).toBeInTheDocument();

    await user.selectOptions(within(filters).getByLabelText("Categoría"), "Entertainment");
    expect(screen.getByText(/· Categoría: Entretenimiento/)).toBeInTheDocument();
    expect(screen.getByText("Ningún gasto coincide con estos filtros.")).toBeInTheDocument();
  });

  it("renders the add-expense form, its validation messages, and the saved feedback in Spanish", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar gasto" }));
    const task = document.getElementById("add-expense-task");

    expect(within(task).getByRole("heading", { name: "Agregar gasto" })).toBeInTheDocument();
    expect(within(task).getByRole("group", { name: "Nuevo gasto" })).toBeInTheDocument();
    expect(within(task).getByPlaceholderText("Descripción")).toBeInTheDocument();
    expect(within(task).getByPlaceholderText("Monto")).toBeInTheDocument();
    expect(within(within(task).getByLabelText("Categoría")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Categoría", "Comida", "Transporte", "Facturas", "Entretenimiento", "Otra"]);
    await user.selectOptions(within(task).getByLabelText("Categoría"), "other");
    expect(within(task).getByLabelText("Categoría personalizada")).toBeInTheDocument();
    await user.selectOptions(within(task).getByLabelText("Categoría"), "");

    await user.click(within(task).getByRole("button", { name: "Guardar gasto" }));
    expect(within(task).getByRole("alert")).toHaveTextContent("Completa los campos obligatorios del gasto.");

    await fillExpense(user, task, "1.001");
    await user.click(within(task).getByRole("button", { name: "Guardar gasto" }));
    expect(within(task).getByRole("alert"))
      .toHaveTextContent("Ingresa un monto positivo con hasta dos decimales, hasta 9999999999999999.99.");
    expect(expenses.addExpense).not.toHaveBeenCalled();

    await user.clear(within(task).getByLabelText("Monto"));
    await user.type(within(task).getByLabelText("Monto"), "12.50");
    await user.click(within(task).getByRole("button", { name: "Guardar gasto" }));
    expect(expenses.addExpense).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amount: "12.50", date: "2026-09-01", category: "food" }));
    expect(screen.getByRole("status")).toHaveTextContent("Gasto guardado.");
  });

  it("reports a saved expense whose refresh failed in Spanish", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { addExpense: vi.fn().mockResolvedValue({ refreshFailed: true }) } });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar gasto" }));
    const task = document.getElementById("add-expense-task");
    await fillExpense(user, task);

    await user.click(within(task).getByRole("button", { name: "Guardar gasto" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Gasto guardado. No se pudo actualizar la actividad. Actualiza la lista antes de hacer otro cambio.");
  });

  it("renders the inline expense edit controls in Spanish", async () => {
    const user = userEvent.setup();
    mockLists({ expenses: { expenses: [lunch] } });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Editar gasto Lunch del 09/01/2026, fila 1" }));

    expect(screen.getByLabelText("Editar descripción")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Editar monto")).toHaveValue("5.00");
    expect(screen.getByLabelText("Editar fecha")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Editar categoría")).toHaveValue("food");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Editar categoría"), "other");
    expect(screen.getByLabelText("Editar categoría personalizada")).toHaveAttribute("placeholder", "Categoría personalizada");
    fireEvent.change(screen.getByLabelText("Editar monto"), { target: { value: "abc" } });
    expect(screen.getByText("Ingresa un monto exacto válido.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("asks for the expense delete confirmation and reports the result in Spanish", async () => {
    const user = userEvent.setup();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockLists({ expenses: { expenses: [lunch] } });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Eliminar gasto Lunch del 09/01/2026, fila 1" }));

    expect(confirmSpy).toHaveBeenCalledExactlyOnceWith("¿Eliminar este gasto?");
    expect(expenses.deleteExpense).toHaveBeenCalledExactlyOnceWith(42);
    expect(screen.getByRole("status")).toHaveTextContent("Gasto eliminado.");
  });

  it("renders the expense loading and load-failure states in Spanish", () => {
    mockLists({ expenses: { loading: true } });
    const view = renderPage();
    expect(screen.getByText("Cargando gastos...")).toBeInTheDocument();
    view.unmount();

    mockLists({ expenses: { expenses: [lunch], loading: true } });
    const refreshing = renderPage();
    expect(screen.getByText("Actualizando gastos…")).toBeInTheDocument();
    refreshing.unmount();

    mockLists({ expenses: { error: new Error("offline") } });
    renderPage();
    expect(screen.getByText("No pudimos cargar tus gastos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeInTheDocument();
  });
});

describe("Activity cash in in Spanish", () => {
  it("renders the cash-in section, list, and row actions in Spanish without changing money or dates", () => {
    mockLists({ cash: { inflows: [transfer, unsafeTransfer] } });
    renderPage();

    expect(screen.getByRole("heading", { name: "Entradas de dinero" })).toBeInTheDocument();
    expect(screen.getByText(/Dinero entrante registrado, incluidas transferencias y reembolsos\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar entradas de dinero" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar entradas de dinero")).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Tabla de entradas de dinero" });
    for (const name of ["Descripción", "Monto", "Fecha", "Acciones"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(within(table).getByText("$24.15")).toBeInTheDocument();
    expect(within(table).getByText("09/01/2026")).toBeInTheDocument();
    expect(within(table).getByText("El monto requiere revisión")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Editar entrada de dinero Transfer from Savings del 09/01/2026, registro 1" })).toBeEnabled();
    expect(within(table).getByRole("button", { name: "Eliminar entrada de dinero Transfer from Savings del 09/01/2026, registro 1" })).toBeEnabled();
  });

  it("renders the cash-in empty, search, loading, and failure states in Spanish", async () => {
    const user = userEvent.setup();
    mockLists();
    const empty = renderPage();
    expect(screen.getByText("Todavía no hay entradas de dinero registradas.")).toBeInTheDocument();
    empty.unmount();

    mockLists({ cash: { inflows: [transfer] } });
    const searching = renderPage();
    await user.type(screen.getByLabelText("Buscar entradas de dinero"), "zzz");
    expect(screen.getByText("Ninguna entrada de dinero coincide con esta búsqueda.")).toBeInTheDocument();
    searching.unmount();

    mockLists({ cash: { loading: true } });
    const loading = renderPage();
    expect(screen.getByText("Cargando entradas de dinero…")).toBeInTheDocument();
    loading.unmount();

    mockLists({ cash: { inflows: [transfer], loading: true } });
    const refreshing = renderPage();
    expect(screen.getByText("Actualizando entradas de dinero…")).toBeInTheDocument();
    refreshing.unmount();

    mockLists({ cash: { error: new Error("offline") } });
    renderPage();
    expect(screen.getByText("No pudimos cargar las entradas de dinero. Actualízalas para intentarlo de nuevo.")).toBeInTheDocument();
  });

  it("renders the cash-in form, its field errors, and the saved feedback in Spanish", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar entrada de dinero" }));
    const form = screen.getByRole("form", { name: "Agregar entrada de dinero" });

    expect(within(form).getByRole("group", { name: "Detalles de la entrada de dinero" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Monto")).toBeInTheDocument();
    fireEvent.submit(form);

    expect(within(form).getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(within(form).getByLabelText("Descripción")).toHaveAccessibleDescription("Ingresa una descripción de 1 a 500 caracteres.");
    expect(within(form).getByLabelText("Monto")).toHaveAccessibleDescription(
      "Ingresa un monto positivo con hasta dos decimales, hasta 9999999999999999.99.");
    expect(cash.createInflow).not.toHaveBeenCalled();

    await user.type(within(form).getByLabelText("Descripción"), "Reembolso");
    await user.type(within(form).getByLabelText("Monto"), "10.00");
    fireEvent.change(within(form).getByLabelText("Fecha"), { target: { value: "2026-09-02" } });
    fireEvent.submit(form);

    await waitFor(() => expect(cash.createInflow).toHaveBeenCalledExactlyOnceWith(
      { description: "Reembolso", amount: "10.00", date: "2026-09-02" }));
    expect(await screen.findByText(
      "Entrada de dinero guardada. Los informes usan la fecha de contabilización de esta entrada.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver Análisis" })).toHaveAttribute("href", "/analytics");
  });

  it("renders the cash-in edit warning and amount-review guidance in Spanish", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { inflows: [unsafeTransfer] } });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Editar entrada de dinero Large transfer del 09/02/2026, registro 2" }));
    const form = screen.getByRole("form", { name: "Editar entrada de dinero" });

    expect(within(form).getByText(/Los cambios actualizan el flujo de efectivo registrado\./)).toBeVisible();
    expect(within(form).getByText("El monto requiere revisión.")).toBeVisible();
    expect(within(form).getByText(/Ingresa de nuevo el monto exacto antes de guardar\./)).toBeVisible();
    expect(within(form).getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("renders the cash-in delete confirmation and result in Spanish", async () => {
    const user = userEvent.setup();
    mockLists({ cash: { inflows: [transfer] } });
    renderPage();

    await user.click(screen.getByRole("button", { name: "Eliminar entrada de dinero Transfer from Savings del 09/01/2026, registro 1" }));
    const confirmation = screen.getByRole("group", { name: "¿Eliminar entrada de dinero: Transfer from Savings (09/01/2026)?" });

    expect(within(confirmation).getByText(/Esto elimina el registro del historial de flujo de efectivo\./)).toBeInTheDocument();
    expect(within(confirmation).getByText(/Si esta entrada se importó/)).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();

    await user.click(within(confirmation).getByRole("button", { name: "Confirmar eliminación de la entrada de dinero" }));

    expect(cash.deleteInflow).toHaveBeenCalledExactlyOnceWith(1);
    expect(await screen.findByText("Entrada de dinero eliminada. Los informes registrados reflejarán su eliminación."))
      .toBeInTheDocument();
  });

  it("keeps the English cash-in surface unchanged after switching back from Spanish", async () => {
    mockLists({ cash: { inflows: [transfer] } });
    await i18n.changeLanguage("en");
    renderPage();

    expect(screen.getByRole("heading", { name: "Cash in" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Cash in table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit cash in Transfer from Savings from 09/01/2026, record 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spending activity" })).toBeInTheDocument();
  });
});
