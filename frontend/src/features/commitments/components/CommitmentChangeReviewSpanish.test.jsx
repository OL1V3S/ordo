import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../shared/localization/i18n";
import CommitmentChangeReview from "./CommitmentChangeReview";

const observations = [
  { expenseId: 4, date: "2026-08-17", amount: 25, description: "Gym membership", category: "health", source: "manual" },
  { expenseId: 5, date: "2026-09-17", amount: 25, description: "Gym membership", category: "health", source: "sunflower_pdf" },
];

const base = {
  commitment: {
    id: "commitment-2", name: "Insurance", category: "insurance", lifecycle: "active", cadence: "monthly",
    timingKind: "dayofmonth", expectedDayOfWeek: null, expectedDay: 20, expectedMonth: null,
    windowBeforeDays: 0, windowAfterDays: 1, amountMode: "fixed", expectedAmount: 80,
    expectedMinimumAmount: null, expectedMaximumAmount: null,
  },
  algorithmVersion: "commitment-change-v1", observations: [],
  amount: { state: "within_expectation", fingerprint: null, decisionState: null, evidenceExpenseIds: [] },
  timing: { state: "within_expectation", fingerprint: null, decisionState: null, evidenceExpenseIds: [] },
  missing: { state: "within_expectation", fingerprint: null, decisionState: null, missedSlotAnchors: [] },
};

const missingChange = (overrides = {}, commitment = {}) => ({
  ...base,
  commitment: { ...base.commitment, ...commitment },
  missing: {
    state: "possibly_ended", fingerprint: "missing-fingerprint", decisionState: "pending",
    missedSlotAnchors: ["2026-08-20", "2026-09-20", "2026-10-20"], ...overrides,
  },
});

const amountChange = {
  ...base,
  commitment: { ...base.commitment, id: "commitment-1", name: "Gym plan", expectedDay: 15, expectedAmount: 20 },
  observations,
  amount: {
    state: "proposed_change", fingerprint: "amount-fingerprint", decisionState: "pending", proposedMode: "fixed",
    proposedAmount: 25, proposedMinimumAmount: null, proposedMaximumAmount: null, evidenceExpenseIds: [4],
  },
  timing: {
    state: "proposed_change", fingerprint: "timing-fingerprint", decisionState: "kept", proposedTimingKind: "dayofmonth",
    proposedDayOfWeek: null, proposedDay: 17, proposedMonth: null, proposedWindowBeforeDays: 1, proposedWindowAfterDays: 0,
    evidenceExpenseIds: [4, 5],
  },
};

function reviewState(changes, overrides = {}) {
  return {
    commitmentChanges: changes, changeEvaluatedOn: "2026-10-29", busyKey: null,
    acceptAmountChange: vi.fn().mockResolvedValue(null), acceptTimingChange: vi.fn().mockResolvedValue(null),
    markEndedFromChange: vi.fn().mockResolvedValue(null), keepChange: vi.fn().mockResolvedValue(null),
    reconsiderChange: vi.fn().mockResolvedValue(null), ...overrides,
  };
}

beforeEach(() => i18n.changeLanguage("es"));
afterEach(() => i18n.changeLanguage("en"));

describe("commitment change review in Spanish", () => {
  it("renders complete count-aware phrases per cadence and change dimension", () => {
    const cases = [
      [missingChange({}, { cadence: "monthly" }), "Han pasado 3 fechas mensuales previstas sin un gasto registrado que coincida."],
      [missingChange({ missedSlotAnchors: ["2026-10-20"] }, { cadence: "weekly" }), "Ha pasado 1 fecha semanal prevista sin un gasto registrado que coincida."],
      [missingChange({ missedSlotAnchors: ["2026-09-20", "2026-10-20"] }, { cadence: "yearly" }), "Han pasado 2 fechas anuales previstas sin un gasto registrado que coincida."],
      [missingChange({ missedSlotAnchors: ["2026-10-20"] }, { cadence: "unknown" }), "Ha pasado 1 fecha prevista sin un gasto registrado que coincida."],
    ];
    for (const [change, expected] of cases) {
      const { unmount } = render(<CommitmentChangeReview state={reviewState([change])} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
      unmount();
    }

    render(<CommitmentChangeReview state={reviewState([amountChange])} />);
    expect(screen.getByText("1 gasto registrado reciente respalda este cambio de monto.")).toBeInTheDocument();
    expect(screen.getByText("2 gastos registrados recientes respaldan este cambio de fechas.")).toBeInTheDocument();
  });

  it("shows the Spanish pending and reviewed sections with comparison and details", () => {
    render(<CommitmentChangeReview state={reviewState([amountChange, missingChange()])} />);

    expect(screen.getByRole("heading", { level: 2, name: "Cambios por revisar" })).toHaveAttribute("id", "changes-review-heading");
    expect(screen.getByText("Revisa la evidencia más reciente antes de cambiar una previsión o el estado de un compromiso. Cada decisión se aplica solo a esta evaluación exacta.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Cambios revisados \(1\)$/ })).toHaveAttribute("id", "kept-changes-heading");
    expect(screen.getByText("Estas observaciones exactas se mantuvieron sin cambiar la previsión guardada. Reconsidera una si quieres revisarla de nuevo.")).toBeInTheDocument();
    expect(screen.getByText("Revisión de monto")).toBeInTheDocument();
    expect(screen.getByText("Revisión de gasto faltante")).toBeInTheDocument();
    expect(screen.getByText("Posiblemente finalizado")).toBeInTheDocument();
    expect(screen.getByText("Esto es una observación, no un cambio automático de estado.")).toBeInTheDocument();
    expect(screen.getByText("Día 15 · 0 días antes / 1 día después")).toBeInTheDocument();
    expect(screen.getByText("Día 17 · 1 día antes / 0 días después")).toBeInTheDocument();
    expect(screen.getByLabelText("Detalles del cambio de monto de Gym plan")).toBeInTheDocument();
    expect(screen.getByLabelText("Detalles del cambio por gasto faltante de Insurance")).toBeInTheDocument();
    expect(screen.getAllByText("Gastos de respaldo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estado de cuenta de Sunflower").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evaluado").length).toBeGreaterThan(0);
    expect(screen.queryByText("Changes to review")).not.toBeInTheDocument();
  });

  it("keeps each decision unambiguous and calls the same operations", async () => {
    const user = userEvent.setup();
    const current = reviewState([amountChange, missingChange()]);
    render(<CommitmentChangeReview state={current} />);

    await user.click(screen.getByRole("button", { name: "Aceptar cambio de monto de Gym plan" }));
    expect(current.acceptAmountChange).toHaveBeenCalledWith("commitment-1", "amount-fingerprint");
    await user.click(screen.getByRole("button", { name: "Mantener previsión actual: monto de Gym plan" }));
    expect(current.keepChange).toHaveBeenCalledWith("commitment-1", "amount", "amount-fingerprint");
    await user.click(screen.getByRole("button", { name: "Mantener activo el compromiso Insurance" }));
    expect(current.keepChange).toHaveBeenCalledWith("commitment-2", "missing", "missing-fingerprint");

    await user.click(screen.getByRole("button", { name: "Marcar Insurance como finalizado" }));
    const confirmation = screen.getByRole("group", { name: /¿Marcar Insurance como finalizado\?/ });
    expect(within(confirmation).getByText("¿Marcar Insurance como finalizado? Esto cambia su estado y podrás volver a cambiarlo desde el compromiso confirmado.")).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "Cancelar marcar Insurance como finalizado" })).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "Confirmar marcar Insurance como finalizado" }));
    expect(current.markEndedFromChange).toHaveBeenCalledWith("commitment-2", "missing-fingerprint");
  });

  it("offers the Spanish reconsider action for kept changes and follows a language change", async () => {
    render(<CommitmentChangeReview state={reviewState([amountChange])} />);

    expect(screen.getByRole("button", { name: "Reconsiderar cambio de fechas de Gym plan", hidden: true })).toBeInTheDocument();
    expect(screen.getByText("Mantenido")).toBeInTheDocument();
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByRole("button", { name: "Reconsider timing change for Gym plan", hidden: true })).toBeInTheDocument();
    expect(screen.getByText("1 recent expense supports this amount change.")).toBeInTheDocument();
  });
});
