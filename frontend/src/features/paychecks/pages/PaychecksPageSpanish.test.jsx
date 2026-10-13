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
  await screen.findByRole("heading", { name: "Tus calendarios de nómina" });
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
    expect(screen.getByRole("heading", { level: 1, name: "Nómina" })).toBeInTheDocument();
    expect(screen.getByText("Tus calendarios de nómina y cuándo esperas que te paguen. Solo esperado; no se suma a tus totales.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar calendario de nómina manualmente" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Calendarios de nómina activos" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Calendarios de nómina pausados", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Calendarios de nómina finalizados", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Calendarios de nómina pausados \(1\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Posibles pagos de nómina descartados \(0\)$/ })).toBeInTheDocument();
    expect(screen.getByText("Los calendarios de nómina pausados no tienen fechas esperadas.")).toBeInTheDocument();
    expect(screen.getByText("Los calendarios de nómina finalizados no tienen fechas esperadas.")).toBeInTheDocument();
    expect(screen.getByText("1 por revisar")).toBeInTheDocument();
    expect(screen.getByText("Revisa los depósitos antes de confirmar un calendario de nómina.")).toBeInTheDocument();

    const profile = within(card("Acme Payroll"));
    expect(profile.getByText("Activo")).toBeInTheDocument();
    expect(profile.getByText("Monto esperado")).toBeInTheDocument();
    expect(profile.getByText("Próximo pago de nómina esperado")).toBeInTheDocument();
    expect(profile.getByText("Esperado, no garantizado.")).toBeInTheDocument();
    expect(profile.getByText("9 ago 2026–11 ago 2026")).toBeInTheDocument();
    expect(profile.getByText("Confirmado a partir de depósitos")).toBeInTheDocument();
    expect(profile.getByText("Fechas en que te pagan").closest("div")).toHaveTextContent("Mensual, día 10");
    expect(profile.getByText("Días antes y después").closest("div")).toHaveTextContent("1 día antes · 1 día después");
    expect(profile.getByText("Depósitos de nómina vinculados").closest("div")).toHaveTextContent("Depósitos vinculados: 3");
    expect(profile.getByText("Depósitos de nómina vinculados (3)")).toBeInTheDocument();
    expect(profile.getByText("Calendarios de nómina verificados el").closest("div")).toHaveTextContent("12 jul 2026");
    expect(profile.getAllByText(/En esa fecha/)).toHaveLength(3);
    expect(profile.getAllByText("Historial de confirmación")).toHaveLength(3);
    expect(profile.getByRole("button", { name: "Editar Acme Payroll", hidden: true })).toBeInTheDocument();
    expect(profile.getByRole("button", { name: "Pausar Acme Payroll", hidden: true })).toBeInTheDocument();
    expect(profile.getByRole("button", { name: "Vincular un depósito a Acme Payroll" })).toBeInTheDocument();

    const candidate = within(card("acme payroll"));
    expect(candidate.getByText("Depósitos observados")).toBeInTheDocument();
    expect(candidate.getByText("Basado en 3 depósitos")).toBeInTheDocument();
    expect(candidate.getByText("Depósitos por revisar (3)")).toBeInTheDocument();
    expect(candidate.getByRole("button", { name: "Revisar y confirmar: acme payroll" })).toBeInTheDocument();
    expect(candidate.getByRole("button", { name: "Descartar: acme payroll", hidden: true })).toBeInTheDocument();

    for (const english of ["Expected amount", "Possible paychecks", "Your pay schedules", "Active pay schedules", "Next expected paycheck"])
      expect(screen.queryByText(english)).not.toBeInTheDocument();
  });

  it("keeps an expectation distinct from recorded money in Spanish", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    profile.evidence[0].assignmentKind = "recorded_receipt";
    loadState({ paychecks: [profile] });
    await renderPage();
    const active = within(card("Acme Payroll"));
    expect(active.getByText("Monto esperado")).toHaveTextContent(/esperado/);
    expect(active.getByText("Esperado, no garantizado.")).toBeInTheDocument();
    expect(active.getByText("Vinculado por ti")).not.toHaveTextContent(/esperad/i);
    expect(active.getByText("Vinculado por ti")).toHaveTextContent(/Vinculado/);
    await user.click(screen.getByLabelText("Detalles de Acme Payroll"));
    await user.click(active.getByRole("button", { name: "Quitar vínculo del depósito" }));
    expect(screen.getByRole("group", { name: "Quitar vínculo del depósito: Acme Payroll" })).toHaveTextContent(/El depósito se mantiene en Movimientos/);
    expect(screen.getByRole("button", { name: "Sí, quitar vínculo" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Sí, quitar vínculo" }));
    expect(paychecksApi.removeReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, 101);
    expect(await screen.findByRole("status")).toHaveTextContent("Vínculo del depósito quitado. El depósito se queda en Movimientos.");
  });

  it("records a received paycheck with localized panel, warnings and cash-in validation", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Vincular un depósito a Acme Payroll" }));
    const panel = screen.getByRole("region", { name: "Depósito para vincular a Acme Payroll" });
    expect(within(panel).getByRole("heading", { name: "Vincular un depósito" })).toBeInTheDocument();
    expect(within(panel).getByText("Vincula a este calendario de nómina un depósito que recibiste. El monto y las fechas esperados no cambian.")).toBeInTheDocument();
    expect(within(panel).getByRole("option", { name: "Actual: 9 ago 2026–11 ago 2026" })).toBeInTheDocument();
    expect(within(panel).getByRole("option", { name: "Anterior: 9 jul 2026–11 jul 2026" })).toBeInTheDocument();
    expect(within(panel).getByText("¿Qué depósito?")).toBeInTheDocument();
    expect(within(panel).getByLabelText(/Agregar un depósito nuevo/)).toBeChecked();
    const form = within(panel).getByRole("form", { name: "Agregar depósito" });
    const description = within(form).getByLabelText("Descripción");
    const amount = within(form).getByLabelText("Monto");
    const date = within(form).getByLabelText("Fecha");

    await user.clear(amount);
    await user.type(amount, "2600.25");
    fireEvent.change(date, { target: { value: "2026-08-15" } });
    expect(within(panel).getByText(/Este monto es distinto del monto esperado/)).toBeInTheDocument();
    expect(within(panel).getByText(/Esta fecha está fuera de las fechas esperadas/)).toBeInTheDocument();

    fireEvent.change(description, { target: { value: "" } });
    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.change(date, { target: { value: "" } });
    await user.click(within(form).getByRole("button", { name: "Agregar depósito" }));
    expect(paychecksApi.recordReceipt).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(description).toHaveAccessibleDescription("Ingresa una descripción.");
    expect(amount).toHaveAccessibleDescription("Ingresa un monto mayor que cero, con hasta dos decimales (máximo 9999999999999999.99).");
    expect(date).toHaveAccessibleDescription("Ingresa una fecha válida.");

    fireEvent.change(description, { target: { value: "x".repeat(501) } });
    await user.click(within(form).getByRole("button", { name: "Agregar depósito" }));
    expect(description).toHaveAccessibleDescription("Usa 500 caracteres o menos.");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(description).toHaveAccessibleDescription("Use 500 characters or fewer.");
    expect(date).toHaveAccessibleDescription("Enter a valid date.");
    await act(async () => { await i18n.changeLanguage("es"); });

    fireEvent.change(description, { target: { value: "Acme Payroll" } });
    fireEvent.change(amount, { target: { value: "2600.25" } });
    fireEvent.change(date, { target: { value: "2026-08-15" } });
    loadState({ paychecks: [makePaycheck({ receiptSlots: [] })] });
    await user.click(within(form).getByRole("button", { name: "Agregar depósito" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, {
      slotAnchor: "2026-08-10",
      newInflow: { description: "Acme Payroll", amount: "2600.25", date: "2026-08-15" },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Depósito vinculado a este calendario de nómina.");
  });

  it("links existing cash in with localized search, empty and load-failure messages", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    loadState({ paychecks: [profile] });
    inflowsApi.getAll.mockResolvedValue(response([{ id: 7, description: "Acme deposit", date: "2026-08-10", amount: "2500.00" }]));
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Vincular un depósito a Acme Payroll" }));
    await user.click(screen.getByLabelText(/Usar un depósito guardado/));
    expect(await screen.findByText("Elegir un depósito")).toBeInTheDocument();
    expect(screen.getByLabelText(/Acme deposit · 10 ago 2026 · USD 2,500\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vincular este depósito" })).toBeDisabled();
    await user.type(screen.getByLabelText("Buscar depósitos"), "zzz");
    expect(screen.getByText("Ningún depósito guardado coincide.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Buscar depósitos"));
    await user.click(screen.getByLabelText(/Acme deposit/));
    await user.click(screen.getByRole("button", { name: "Vincular este depósito" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, { slotAnchor: "2026-08-10", existingInflowId: 7 });
  });

  it("shows a localized message when existing cash in cannot be loaded", async () => {
    const user = userEvent.setup();
    inflowsApi.getAll.mockRejectedValue(new Error("offline"));
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Vincular un depósito a Acme Payroll" }));
    await user.click(screen.getByLabelText(/Usar un depósito guardado/));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tus depósitos. Cancela e inténtalo de nuevo.");
  });

  it("localizes the manual paycheck form, its labels and its validation messages", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Agregar calendario de nómina manualmente" }));
    const section = screen.getByRole("region", { name: "Agregar un calendario de nómina" });
    expect(within(section).getByText(/Tú lo configuras\. No se basa en depósitos ni lo confirma tu empleador/)).toBeInTheDocument();
    const form = within(section).getByRole("form", { name: "Crear calendario de nómina" });
    expect(within(form).getByText(/Crea un calendario de nómina activo para tu pago de nómina esperado/)).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Cada dos semanas" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Quincenal" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Rango de monto" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Día del mes en que te pagan")).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Crear calendario de nómina" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Revisa los campos marcados.");
    expect(within(form).getByLabelText("Nombre para mostrar")).toHaveAccessibleDescription("Ingresa un nombre para mostrar de 1 a 500 caracteres.");
    expect(within(form).getByLabelText("Día del mes en que te pagan")).toHaveAccessibleDescription("Ingresa un día entero del 1 al 30, o elige fin de mes.");
    expect(within(form).getByLabelText("Monto fijo")).toHaveAccessibleDescription("Ingresa un monto mayor que cero, con hasta dos decimales (máximo 9999999999999999.99).");

    await user.selectOptions(within(form).getByLabelText("Frecuencia"), "biweekly");
    expect(within(form).getByLabelText("Fecha inicial en que te pagan")).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText("Frecuencia"), "semimonthly");
    await user.type(within(form).getByLabelText("Nombre para mostrar"), "Salario");
    await user.type(within(form).getByLabelText("Primer día en que te pagan: día del mes"), "1");
    await user.selectOptions(within(form).getByLabelText("Segundo día en que te pagan"), "month_end");
    await user.type(within(form).getByLabelText("Monto fijo"), "100");
    await user.type(within(form).getByLabelText("Días antes"), "9");
    await user.click(within(form).getByRole("button", { name: "Crear calendario de nómina" }));
    expect(paychecksApi.createPaycheck).not.toHaveBeenCalled();
    expect(within(form).getByLabelText("Segundo día en que te pagan")).toHaveAccessibleDescription(/también en febrero/);
    expect(within(form).getByLabelText("Días antes")).toHaveAccessibleDescription("Ingresa un número entero del 0 al 3.");
  });

  it("localizes the end confirmation", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Acciones para Acme Payroll" }));
    await user.click(screen.getByRole("button", { name: "Finalizar Acme Payroll" }));
    const group = screen.getByRole("group", { name: "Finalizar Acme Payroll" });
    expect(group).toHaveTextContent("¿Finalizar Acme Payroll? Sus pagos de nómina esperados se detendrán. El calendario de nómina y sus depósitos vinculados se quedan, y puedes volver a activarlo.");
    expect(within(group).getByRole("button", { name: "Sí, finalizarlo" })).toHaveFocus();
    expect(within(group).getByRole("button", { name: "Cancelar finalización" })).toBeEnabled();
  });

  it("maps a known backend code to Spanish and follows a language change", async () => {
    const user = userEvent.setup();
    paychecksApi.confirmCandidate.mockRejectedValue({ response: { status: 409, data: { code: "confirmation_conflict" } } });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Revisar y confirmar: acme payroll" }));
    await user.click(screen.getByRole("button", { name: "Guardar calendario de nómina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Los depósitos cambiaron mientras confirmabas. Revisa los depósitos más recientes y vuelve a intentarlo.");
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByRole("alert")).toHaveTextContent("The deposits changed while you were confirming. Check the latest deposits, then try again.");
  });

  it("shows a readable Spanish fallback for an unknown backend code", async () => {
    const user = userEvent.setup();
    paychecksApi.confirmCandidate.mockRejectedValue({ response: { status: 400, data: { code: "brand_new_code" } } });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Revisar y confirmar: acme payroll" }));
    await user.click(screen.getByRole("button", { name: "Guardar calendario de nómina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos completar la solicitud. Inténtalo de nuevo.");
  });

  it("shows a Spanish load failure and refresh action", async () => {
    paychecksApi.getCandidates.mockRejectedValue({ response: { status: 500 } });
    render(<PaychecksPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu nómina. Actualiza para intentarlo de nuevo");
    expect(screen.getByRole("button", { name: "Actualizar nómina" })).toBeInTheDocument();
  });

  it("shows localized empty states", async () => {
    loadState({ candidates: [], paychecks: [] });
    render(<PaychecksPage />);
    expect(await screen.findByText("Todavía no hay calendarios de nómina")).toBeInTheDocument();
    expect(screen.getByText(/Un depósito por sí solo no es un pago de nómina confirmado/)).toBeInTheDocument();
    expect(screen.getByText(/No hay posibles pagos de nómina por revisar/)).toBeInTheDocument();
    expect(screen.getByText("No hay posibles pagos de nómina descartados.")).toBeInTheDocument();
  });
});
