import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaychecksPage from "./PaychecksPage";
import i18n from "../../../shared/localization/i18n";
import { paychecksApi } from "../api/paychecksApi";
import { inflowsApi } from "../../inflows/api/inflowsApi";
import { makeCandidate, makeCandidateResponse, makePaycheck, makePaychecksResponse } from "../test/paycheckFixtures";

vi.mock("../api/paychecksApi", () => ({ paychecksApi: {
  getCandidates: vi.fn(), getPaychecks: vi.fn(), confirmCandidate: vi.fn(),
  dismissCandidate: vi.fn(), reconsiderCandidate: vi.fn(), createPaycheck: vi.fn(),
  updatePaycheck: vi.fn(), updateLifecycle: vi.fn(), recordReceipt: vi.fn(), removeReceipt: vi.fn(),
} }));
vi.mock("../../inflows/api/inflowsApi", () => ({ inflowsApi: { getAll: vi.fn() } }));

const response = (data) => ({ data });
const card = (name) => screen.getByRole("heading", { name, exact: true }).closest("li");

function loadState({ candidates = [makeCandidate()], dismissedCandidates = [], paychecks = [makePaycheck()] } = {}) {
  paychecksApi.getCandidates.mockResolvedValue(response(makeCandidateResponse({ candidates, dismissedCandidates })));
  paychecksApi.getPaychecks.mockResolvedValue(response(makePaychecksResponse({ paychecks })));
}
async function renderPage() {
  render(<PaychecksPage />);
  await screen.findByRole("heading", { name: "Tus pagos de nómina" });
}

beforeEach(async () => {
  vi.resetAllMocks();
  loadState();
  paychecksApi.confirmCandidate.mockResolvedValue(response({ paycheck: makePaycheck(), alreadyConfirmed: false }));
  paychecksApi.recordReceipt.mockResolvedValue(response({ paycheck: makePaycheck(), alreadyRecorded: false }));
  paychecksApi.removeReceipt.mockResolvedValue(response(makePaycheck()));
  inflowsApi.getAll.mockResolvedValue(response([]));
  await i18n.changeLanguage("es");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Paychecks page in Spanish", () => {
  it("renders profiles, candidates and groups in Spanish while keeping user data and formats", async () => {
    const paused = makePaycheck({ id: "22222222-2222-2222-2222-222222222222", displayName: "Paused pay", lifecycle: "paused" });
    const ended = makePaycheck({ id: "33333333-3333-3333-3333-333333333333", displayName: "Ended pay", lifecycle: "ended", nextProjection: null });
    loadState({ paychecks: [makePaycheck(), paused, ended] });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Pagos de nómina" })).toBeInTheDocument();
    expect(screen.getByText("Administra los pagos de nómina previstos y revisa los posibles pagos de nómina.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar pago de nómina manualmente" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Pagos de nómina activos" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pagos de nómina pausados", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pagos de nómina finalizados", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Pagos de nómina pausados \(1\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Posibles pagos de nómina descartados \(0\)$/ })).toBeInTheDocument();
    expect(screen.getByText("Los pagos de nómina pausados no tienen una ventana prevista activa.")).toBeInTheDocument();
    expect(screen.getByText("Los pagos de nómina finalizados no tienen una ventana prevista activa.")).toBeInTheDocument();
    expect(screen.getByText("1 por revisar")).toBeInTheDocument();
    expect(screen.getByText("Revisa los depósitos antes de confirmar una previsión.")).toBeInTheDocument();

    const profile = within(card("Acme Payroll"));
    expect(profile.getByText("Activo")).toBeInTheDocument();
    expect(profile.getByText("Monto previsto")).toBeInTheDocument();
    expect(profile.getByText("Próxima ventana prevista")).toBeInTheDocument();
    expect(profile.getByText("Previsto, no garantizado.")).toBeInTheDocument();
    expect(profile.getByText("Aug 9, 2026–Aug 11, 2026")).toBeInTheDocument();
    expect(profile.getByText("Confirmado a partir de depósitos")).toBeInTheDocument();
    expect(profile.getByText("Calendario").closest("div")).toHaveTextContent("Mensual, día 10");
    expect(profile.getByText("Ventana de fechas prevista").closest("div")).toHaveTextContent("1 día antes · 1 día después");
    expect(profile.getByText("Depósitos de nómina vinculados").closest("div")).toHaveTextContent("3 depósito(s) vinculado(s)");
    expect(profile.getByText("Depósitos de nómina vinculados (3)")).toBeInTheDocument();
    expect(profile.getByText("Perfiles evaluados").closest("div")).toHaveTextContent("Jul 12, 2026");
    expect(profile.getAllByText(/En la fecha del calendario/)).toHaveLength(3);
    expect(profile.getAllByText("Historial de confirmación")).toHaveLength(3);
    expect(profile.getByRole("button", { name: "Editar Acme Payroll", hidden: true })).toBeInTheDocument();
    expect(profile.getByRole("button", { name: "Pausar Acme Payroll", hidden: true })).toBeInTheDocument();
    expect(profile.getByRole("button", { name: "Registrar pago recibido de Acme Payroll" })).toBeInTheDocument();

    const candidate = within(card("acme payroll"));
    expect(candidate.getByText("Depósitos observados")).toBeInTheDocument();
    expect(candidate.getByText("Basado en 3 depósitos")).toBeInTheDocument();
    expect(candidate.getByText("Depósitos por revisar (3)")).toBeInTheDocument();
    expect(candidate.getByRole("button", { name: "Revisar y confirmar acme payroll" })).toBeInTheDocument();
    expect(candidate.getByRole("button", { name: "Descartar acme payroll", hidden: true })).toBeInTheDocument();

    for (const english of ["Expected amount", "Possible paychecks", "Your paychecks", "Active paychecks", "Next expected window"])
      expect(screen.queryByText(english)).not.toBeInTheDocument();
  });

  it("keeps an expectation distinct from recorded money in Spanish", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    profile.evidence[0].assignmentKind = "recorded_receipt";
    loadState({ paychecks: [profile] });
    await renderPage();
    const active = within(card("Acme Payroll"));
    expect(active.getByText("Monto previsto")).toHaveTextContent(/previsto/);
    expect(active.getByText("Previsto, no garantizado.")).toBeInTheDocument();
    expect(active.getByText("Pago de nómina recibido")).not.toHaveTextContent(/previst/i);
    expect(active.getByText("Pago de nómina recibido")).toHaveTextContent(/recibido/);
    await user.click(screen.getByLabelText("Detalles de Acme Payroll"));
    await user.click(active.getByRole("button", { name: "Quitar vínculo de pago de nómina" }));
    expect(screen.getByRole("group", { name: "Quitar el vínculo de pago de nómina de Acme Payroll" })).toHaveTextContent(/La entrada de dinero se mantendrá en Actividad/);
    expect(screen.getByRole("button", { name: "Confirmar eliminación del vínculo" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirmar eliminación del vínculo" }));
    expect(paychecksApi.removeReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, 101);
    expect(await screen.findByRole("status")).toHaveTextContent("Vínculo de pago de nómina quitado. La entrada de dinero se mantiene en Actividad.");
  });

  it("records a received paycheck with localized panel, warnings and cash-in validation", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Registrar pago recibido de Acme Payroll" }));
    const panel = screen.getByRole("region", { name: "Registrar pago de nómina recibido de Acme Payroll" });
    expect(within(panel).getByRole("heading", { name: "Registrar pago recibido" })).toBeInTheDocument();
    expect(within(panel).getByText("Vincula una entrada de dinero real a este pago de nómina. Esto no cambia la previsión guardada.")).toBeInTheDocument();
    expect(within(panel).getByRole("option", { name: "Actual: Aug 9, 2026–Aug 11, 2026" })).toBeInTheDocument();
    expect(within(panel).getByRole("option", { name: "Anterior: Jul 9, 2026–Jul 11, 2026" })).toBeInTheDocument();
    expect(within(panel).getByText("Origen de la entrada de dinero")).toBeInTheDocument();
    expect(within(panel).getByLabelText(/Ingresar una nueva entrada de dinero/)).toBeChecked();
    const form = within(panel).getByRole("form", { name: "Agregar entrada de dinero" });
    const description = within(form).getByLabelText("Descripción");
    const amount = within(form).getByLabelText("Monto");
    const date = within(form).getByLabelText("Fecha");

    await user.clear(amount);
    await user.type(amount, "2600.25");
    fireEvent.change(date, { target: { value: "2026-08-15" } });
    expect(within(panel).getByText(/El monto difiere de la previsión fija/)).toBeInTheDocument();
    expect(within(panel).getByText(/La fecha está fuera de la ventana prevista de este pago de nómina/)).toBeInTheDocument();

    fireEvent.change(description, { target: { value: "" } });
    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.change(date, { target: { value: "" } });
    await user.click(within(form).getByRole("button", { name: "Agregar entrada de dinero" }));
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(description).toHaveAccessibleDescription("Ingresa una descripción.");
    expect(amount).toHaveAccessibleDescription("Ingresa un monto positivo con hasta dos decimales, hasta 9999999999999999.99.");
    expect(date).toHaveAccessibleDescription("Ingresa una fecha válida.");

    fireEvent.change(description, { target: { value: "x".repeat(501) } });
    await user.click(within(form).getByRole("button", { name: "Agregar entrada de dinero" }));
    expect(description).toHaveAccessibleDescription("Usa 500 caracteres o menos.");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(description).toHaveAccessibleDescription("Use 500 characters or fewer.");
    expect(date).toHaveAccessibleDescription("Enter a valid date.");
    await act(async () => { await i18n.changeLanguage("es"); });

    fireEvent.change(description, { target: { value: "Acme Payroll" } });
    fireEvent.change(amount, { target: { value: "2600.25" } });
    fireEvent.change(date, { target: { value: "2026-08-15" } });
    loadState({ paychecks: [makePaycheck({ receiptSlots: [] })] });
    await user.click(within(form).getByRole("button", { name: "Agregar entrada de dinero" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, {
      slotAnchor: "2026-08-10",
      newInflow: { description: "Acme Payroll", amount: "2600.25", date: "2026-08-15" },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Pago de nómina recibido. La entrada de dinero real ya está vinculada.");
  });

  it("links existing cash in with localized search, empty and load-failure messages", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    loadState({ paychecks: [profile] });
    inflowsApi.getAll.mockResolvedValue(response([{ id: 7, description: "Acme deposit", date: "2026-08-10", amount: "2500.00" }]));
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Registrar pago recibido de Acme Payroll" }));
    await user.click(screen.getByLabelText(/Usar una entrada de dinero existente/));
    expect(await screen.findByText("Elegir entrada de dinero")).toBeInTheDocument();
    expect(screen.getByLabelText(/Acme deposit · Aug 10, 2026 · \$2,500\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vincular entrada de dinero" })).toBeDisabled();
    await user.type(screen.getByLabelText("Buscar entradas de dinero"), "zzz");
    expect(screen.getByText("Ninguna entrada de dinero disponible coincide.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Buscar entradas de dinero"));
    await user.click(screen.getByLabelText(/Acme deposit/));
    await user.click(screen.getByRole("button", { name: "Vincular entrada de dinero" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, { slotAnchor: "2026-08-10", existingInflowId: 7 });
  });

  it("shows a localized message when existing cash in cannot be loaded", async () => {
    const user = userEvent.setup();
    inflowsApi.getAll.mockRejectedValue(new Error("offline"));
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Registrar pago recibido de Acme Payroll" }));
    await user.click(screen.getByLabelText(/Usar una entrada de dinero existente/));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las entradas de dinero. Cancela e inténtalo de nuevo.");
  });

  it("localizes the manual paycheck form, its labels and its validation messages", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar pago de nómina manualmente" }));
    const section = screen.getByRole("region", { name: "Agregar una previsión de nómina" });
    expect(within(section).getByText(/Esta es tu propia previsión, no verificada por el empleador/)).toBeInTheDocument();
    const form = within(section).getByRole("form", { name: "Crear pago de nómina" });
    expect(within(form).getByText(/Crea un perfil activo para tu pago de nómina previsto/)).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Cada dos semanas" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Dos veces al mes" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Rango de monto" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Día del ancla mensual")).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Crear pago de nómina" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(within(form).getByLabelText("Nombre para mostrar")).toHaveAccessibleDescription("Ingresa un nombre para mostrar de 1 a 500 caracteres.");
    expect(within(form).getByLabelText("Día del ancla mensual")).toHaveAccessibleDescription("Ingresa un día entero del 1 al 30, o elige fin de mes.");
    expect(within(form).getByLabelText("Monto fijo")).toHaveAccessibleDescription("Ingresa un monto positivo con hasta dos decimales, hasta 9999999999999999.99.");

    await user.selectOptions(within(form).getByLabelText("Frecuencia"), "biweekly");
    expect(within(form).getByLabelText("Fecha ancla de referencia")).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText("Frecuencia"), "semimonthly");
    await user.type(within(form).getByLabelText("Nombre para mostrar"), "Salario");
    await user.type(within(form).getByLabelText("Día de la primera ancla"), "1");
    await user.selectOptions(within(form).getByLabelText("Segunda ancla"), "month_end");
    await user.type(within(form).getByLabelText("Monto fijo"), "100");
    await user.type(within(form).getByLabelText("Días antes"), "9");
    await user.click(within(form).getByRole("button", { name: "Crear pago de nómina" }));
    expect(paychecksApi.createPaycheck).not.toHaveBeenCalled();
    expect(within(form).getByLabelText("Segunda ancla")).toHaveAccessibleDescription(/incluso al cruzar el límite de febrero/);
    expect(within(form).getByLabelText("Días antes")).toHaveAccessibleDescription("Ingresa un número entero del 0 al 3.");
  });

  it("localizes the end confirmation", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Acciones para Acme Payroll" }));
    await user.click(screen.getByRole("button", { name: "Finalizar Acme Payroll" }));
    const group = screen.getByRole("group", { name: "Finalizar Acme Payroll" });
    expect(group).toHaveTextContent("¿Finalizar Acme Payroll? Su proyección se detendrá. El perfil y la evidencia vinculada se mantendrán, y podrás reactivarlo.");
    expect(within(group).getByRole("button", { name: "Confirmar finalización" })).toHaveFocus();
    expect(within(group).getByRole("button", { name: "Cancelar finalización" })).toBeEnabled();
  });

  it("maps a known backend code to Spanish and follows a language change", async () => {
    const user = userEvent.setup();
    paychecksApi.confirmCandidate.mockRejectedValue({ response: { status: 409, data: { code: "confirmation_conflict" } } });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Revisar y confirmar acme payroll" }));
    await user.click(screen.getByRole("button", { name: "Confirmar pago de nómina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La evidencia cambió durante la confirmación. Revisa la evidencia más reciente antes de intentarlo de nuevo.");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByRole("alert")).toHaveTextContent("The evidence changed during confirmation. Review the latest evidence before trying again.");
  });

  it("shows a readable Spanish fallback for an unknown backend code", async () => {
    const user = userEvent.setup();
    paychecksApi.confirmCandidate.mockRejectedValue({ response: { status: 400, data: { code: "brand_new_code" } } });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Revisar y confirmar acme payroll" }));
    await user.click(screen.getByRole("button", { name: "Confirmar pago de nómina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo completar la solicitud. Inténtalo de nuevo.");
  });

  it("shows a Spanish load failure and refresh action", async () => {
    paychecksApi.getCandidates.mockRejectedValue({ response: { status: 500 } });
    render(<PaychecksPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los pagos de nómina. Actualiza para intentarlo de nuevo");
    expect(screen.getByRole("button", { name: "Actualizar pagos de nómina" })).toBeInTheDocument();
  });

  it("shows localized empty states", async () => {
    loadState({ candidates: [], paychecks: [] });
    render(<PaychecksPage />);
    expect(await screen.findByText("Todavía no hay perfiles de pago de nómina")).toBeInTheDocument();
    expect(screen.getByText(/Un depósito por sí solo no es un pago de nómina confirmado/)).toBeInTheDocument();
    expect(screen.getByText(/Ningún posible pago de nómina requiere revisión/)).toBeInTheDocument();
    expect(screen.getByText("No hay posibles pagos de nómina descartados.")).toBeInTheDocument();
  });
});
