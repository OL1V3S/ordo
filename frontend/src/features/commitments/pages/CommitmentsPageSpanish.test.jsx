import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../../shared/localization/i18n";
import { useCommitments } from "../hooks/useCommitments";
import CommitmentsPage from "./CommitmentsPage";

vi.mock("../hooks/useCommitments", () => ({ useCommitments: vi.fn() }));

const evidence = [
  { expenseId: 1, date: "2026-05-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
  { expenseId: 2, date: "2026-06-15", amount: 20, description: "Gym membership", category: "health", source: "sunflower_pdf" },
  { expenseId: 3, date: "2026-07-15", amount: 20, description: "Gym membership", category: "health", source: "manual" },
];

const candidate = {
  fingerprint: "fingerprint-1", algorithmVersion: "commitment-v1", description: "Gym membership", category: "health",
  cadence: "monthly", timingKind: "dayofmonth", expectedDayOfWeek: null, expectedDay: 15, expectedMonth: null,
  windowBeforeDays: 0, windowAfterDays: 0, observedAmountMode: "fixed", observedMedianAmount: 20,
  observedMinimumAmount: 20, observedMaximumAmount: 20, coveredFrom: "2026-05-15", coveredTo: "2026-07-15",
  occurrenceCount: 3, evidenceRule: "consecutive_calendar_months", evidence,
};

const rangeCandidate = {
  ...candidate, fingerprint: "fingerprint-3", description: "Water bill", observedAmountMode: "range",
  observedMinimumAmount: 18, observedMaximumAmount: 22, evidenceRule: "unknown_rule_code",
  evidence: evidence.map((item) => ({ ...item, description: "Water bill" })),
};

const dismissedCandidate = {
  ...candidate, fingerprint: "fingerprint-2", description: "Streaming service",
  evidence: evidence.map((item) => ({ ...item, description: "Streaming service" })),
};

const commitment = {
  id: "commitment-1", name: "Rent", category: "housing", lifecycle: "active", cadence: "monthly",
  timingKind: "dayofmonth", expectedDayOfWeek: null, expectedDay: 1, expectedMonth: null,
  windowBeforeDays: 1, windowAfterDays: 1, amountMode: "fixed", expectedAmount: 1200,
  expectedMinimumAmount: null, expectedMaximumAmount: null,
  evidence: evidence.map((item) => ({ ...item, description: "Rent", amount: 1200, category: "housing" })),
};

const commitmentChange = {
  commitment: { ...commitment, id: "commitment-4", name: "Gym plan", expectedAmount: 20, expectedDay: 15 },
  algorithmVersion: "commitment-change-v1", observations: evidence,
  amount: {
    state: "proposed_change", fingerprint: "amount-fingerprint", decisionState: "pending",
    proposedMode: "fixed", proposedAmount: 25, proposedMinimumAmount: null, proposedMaximumAmount: null,
    evidenceExpenseIds: [1, 2],
  },
  timing: {
    state: "proposed_change", fingerprint: "timing-fingerprint", decisionState: "kept",
    proposedTimingKind: "dayofmonth", proposedDayOfWeek: null, proposedDay: 17, proposedMonth: null,
    proposedWindowBeforeDays: 0, proposedWindowAfterDays: 0, evidenceExpenseIds: [2, 3],
  },
  missing: { state: "within_expectation", fingerprint: null, decisionState: null, missedSlotAnchors: [] },
};

function state(overrides = {}) {
  return {
    candidates: [candidate, rangeCandidate], dismissedCandidates: [dismissedCandidate], commitments: [commitment],
    commitmentChanges: [commitmentChange], changeEvaluatedOn: "2026-10-29", loading: false, loadError: null,
    actionError: null, notice: null, busyKey: null,
    refresh: vi.fn(), clearMessages: vi.fn(), dismissCandidate: vi.fn().mockResolvedValue(null),
    reconsiderCandidate: vi.fn().mockResolvedValue(null), confirmCandidate: vi.fn().mockResolvedValue({ alreadyConfirmed: false }),
    updateCommitment: vi.fn().mockResolvedValue({ id: commitment.id }), updateLifecycle: vi.fn().mockResolvedValue({ id: commitment.id }),
    acceptAmountChange: vi.fn().mockResolvedValue(null), acceptTimingChange: vi.fn().mockResolvedValue(null),
    markEndedFromChange: vi.fn().mockResolvedValue(null), keepChange: vi.fn().mockResolvedValue(null),
    reconsiderChange: vi.fn().mockResolvedValue(null), ...overrides,
  };
}

const card = (name) => screen.getByRole("heading", { name, exact: true }).closest("li");
async function menuAction(user, name, action) {
  await user.click(screen.getByRole("button", { name: `Acciones para ${name}` }));
  await user.click(screen.getByRole("button", { name: action }));
}
const historyHeading = (name) => screen.getByRole("heading", { level: 2, name: new RegExp(`^${name} \\(\\d+\\)$`) });

function renderPage(initialEntries = ["/commitments"]) {
  return render(<CommitmentsPage />, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>,
  });
}

beforeEach(async () => {
  useCommitments.mockReturnValue(state());
  await i18n.changeLanguage("es");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Commitments page in Spanish", () => {
  it("renders the page, review links, and sections in Spanish with count-aware text and stable ids", () => {
    const paused = { ...commitment, id: "commitment-2", name: "Paused rent", lifecycle: "paused" };
    useCommitments.mockReturnValue(state({ commitments: [commitment, paused] }));
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Compromisos" })).toBeInTheDocument();
    expect(screen.getByText("Administra las previsiones guardadas y revisa los posibles cambios.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Revisiones de compromisos" });
    expect(within(nav).getByRole("link", { name: "1 cambio por revisar" })).toHaveAttribute("href", "#changes-review-heading");
    expect(within(nav).getByRole("link", { name: "2 posibles compromisos" })).toHaveAttribute("href", "#candidate-heading");
    expect(screen.getByRole("heading", { level: 2, name: "Tus compromisos" })).toHaveAttribute("id", "confirmed-heading");
    expect(screen.getByRole("heading", { level: 2, name: "Cambios por revisar" })).toHaveAttribute("id", "changes-review-heading");
    expect(screen.getByRole("heading", { level: 2, name: "Posibles compromisos" })).toHaveAttribute("id", "candidate-heading");
    expect(screen.getByLabelText("Compromisos activos")).toBeInTheDocument();
    expect(screen.getByText("2 por revisar")).toBeInTheDocument();
    expect(screen.getByText("Revisa los gastos registrados antes de confirmar una previsión.")).toBeInTheDocument();
    expect(historyHeading("Compromisos pausados")).toBeInTheDocument();
    expect(screen.getByLabelText("Compromisos pausados")).toBeInTheDocument();
    expect(historyHeading("Cambios revisados")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Posibles compromisos descartados \(1\)$/ })).toHaveAttribute("id", "dismissed-heading");
    expect(screen.getByText("El descarte se aplica solo a la evidencia exacta que revisaste. Reconsidera uno para revisarlo de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("Your commitments")).not.toBeInTheDocument();
    expect(screen.queryByText("Possible commitments")).not.toBeInTheDocument();
  });

  it("keeps an expected commitment distinct from the expenses actually recorded", () => {
    renderPage();

    const saved = within(card("Rent"));
    expect(saved.getByText("Activo")).toBeInTheDocument();
    expect(saved.getByText("Monto previsto")).toBeInTheDocument();
    expect(saved.getAllByText("USD 1,200.00")[0]).toBeInTheDocument();
    expect(saved.getByText("Mensual", { exact: false })).toBeInTheDocument();
    expect(saved.getByText("Día 1, con una ventana de 1 día antes / 1 día después")).toBeInTheDocument();
    expect(saved.getByText("3 gastos vinculados")).toBeInTheDocument();
    expect(saved.getAllByText("Registros usados para confirmar").length).toBeGreaterThan(0);
    expect(saved.getAllByText("Estado de cuenta de Sunflower").length).toBeGreaterThan(0);
    expect(saved.getAllByText("Ingresado manualmente").length).toBeGreaterThan(0);

    const fixed = within(card("Gym membership"));
    expect(fixed.getByText("Basado en 3 gastos registrados")).toBeInTheDocument();
    expect(fixed.getByText("3 gastos registrados · Meses calendario consecutivos")).toBeInTheDocument();
    expect(fixed.getByText("Idéntico cada vez")).toBeInTheDocument();
    expect(fixed.getByText("Fechas observadas")).toBeInTheDocument();
    const range = within(card("Water bill"));
    expect(range.getByText("Basado en 3 gastos registrados. Historial observado, no una previsión guardada.")).toBeInTheDocument();
    expect(range.getByText("Rango de monto observado")).toBeInTheDocument();
    expect(range.getByText("3 gastos registrados · Unknown rule code")).toBeInTheDocument();
    expect(range.getByText("Mediana USD 20.00")).toBeInTheDocument();
  });

  it("shows the Spanish change review with the decision effect on the saved expectation", () => {
    renderPage();

    const pending = within(screen.getByRole("heading", { level: 2, name: "Cambios por revisar" }).closest("section"));
    expect(pending.getByText("Requiere tu decisión")).toBeInTheDocument();
    expect(pending.getByText("Revisión de monto")).toBeInTheDocument();
    expect(pending.getByText("2 gastos registrados recientes respaldan este cambio de monto.")).toBeInTheDocument();
    expect(pending.getByText("Previsión actual")).toBeInTheDocument();
    expect(pending.getByText("Cambio observado")).toBeInTheDocument();
    expect(pending.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceptar cambio de monto de Gym plan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mantener previsión actual: monto de Gym plan" })).toBeEnabled();
    expect(screen.getByText("Revisión de fechas")).toBeInTheDocument();
    expect(screen.getByText("Mantenido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconsiderar cambio de fechas de Gym plan", hidden: true })).toBeInTheDocument();
  });

  it("runs the dismiss, review, end, and edit flows through Spanish controls without changing calls", async () => {
    const user = userEvent.setup();
    const current = state();
    useCommitments.mockReturnValue(current);
    renderPage();

    await menuAction(user, "Gym membership", "Descartar Gym membership");
    expect(current.dismissCandidate).toHaveBeenCalledWith("fingerprint-1");
    expect(screen.getByRole("button", { name: "Reconsiderar Streaming service" })).toBeInTheDocument();
    expect(screen.getByText("Posible compromiso descartado")).toBeInTheDocument();

    await menuAction(user, "Rent", "Finalizar Rent");
    const confirmation = screen.getByRole("group", { name: "Finalizar Rent" });
    expect(within(confirmation).getByText("¿Finalizar Rent? La previsión guardada y los registros vinculados se conservarán. Puedes reactivarlo.")).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "Cancelar finalización" })).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "Confirmar finalización" }));
    expect(current.updateLifecycle).toHaveBeenCalledWith("commitment-1", "ended");
  });

  it("opens the Spanish review and edit forms from the cards", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Revisar y confirmar Gym membership" }));
    expect(screen.getByRole("form", { name: "Confirmar compromiso" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await menuAction(user, "Rent", "Editar Rent");
    expect(screen.getByRole("form", { name: "Guardar cambios" })).toBeInTheDocument();
  });

  it("shows Spanish loading, refresh, error, and stale-information states", () => {
    useCommitments.mockReturnValue(state({ loading: true, candidates: [], commitments: [], dismissedCandidates: [], commitmentChanges: [] }));
    const { unmount } = renderPage();
    expect(screen.getByText("Cargando compromisos...")).toBeInTheDocument();
    unmount();

    useCommitments.mockReturnValue(state({ loadError: "Algo salió mal. Inténtalo de nuevo." }));
    renderPage();
    expect(screen.getByText("Algo salió mal. Inténtalo de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeEnabled();
  });

  it("still focuses the pending review heading from the Home hash target", async () => {
    renderPage(["/commitments#changes-review-heading"]);
    const heading = await screen.findByRole("heading", { name: "Cambios por revisar" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
