import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../shared/localization/i18n";
import CommitmentForm from "./CommitmentForm";

const model = {
  description: "Membership", category: "health", cadence: "monthly", timingKind: "dayofmonth", expectedDay: 15,
  windowBeforeDays: 1, windowAfterDays: 1, observedAmountMode: "fixed", observedMedianAmount: 20,
  observedMinimumAmount: 20, observedMaximumAmount: 20,
};

function renderForm(props = {}) {
  const onSubmit = vi.fn();
  render(<CommitmentForm model={model} fingerprint="candidate-1" submitLabel="Confirmar compromiso" busy={false}
    onSubmit={onSubmit} onCancel={vi.fn()} {...props} />);
  return onSubmit;
}

beforeEach(() => i18n.changeLanguage("es"));
afterEach(() => i18n.changeLanguage("en"));

describe("commitment form in Spanish", () => {
  it("labels every field and option in Spanish", () => {
    renderForm();

    for (const label of ["Nombre", "Categoría", "Frecuencia", "Fecha mensual", "Día previsto", "Días antes", "Días después", "Tipo de monto", "Monto previsto"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("option", { name: "Semanal" })).toHaveValue("weekly");
    expect(screen.getByRole("option", { name: "Mensual" })).toHaveValue("monthly");
    expect(screen.getByRole("option", { name: "Anual" })).toHaveValue("yearly");
    expect(screen.getByRole("option", { name: "Día del mes" })).toHaveValue("dayofmonth");
    expect(screen.getByRole("option", { name: "Fin de mes" })).toHaveValue("monthend");
    expect(screen.getByRole("option", { name: "Monto fijo" })).toHaveValue("fixed");
    expect(screen.getByRole("option", { name: "Rango de montos" })).toHaveValue("range");
    expect(screen.getByRole("button", { name: "Confirmar compromiso" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    expect(screen.queryByLabelText("Cadence")).not.toBeInTheDocument();
  });

  it("keeps canonical request values when Spanish labels are selected", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText("Frecuencia"), "weekly");
    expect(screen.getByRole("option", { name: "Lunes" })).toHaveValue("monday");
    expect(screen.getByRole("option", { name: "Sábado" })).toHaveValue("saturday");
    await user.selectOptions(screen.getByLabelText("Día de la semana previsto"), "friday");
    await user.selectOptions(screen.getByLabelText("Tipo de monto"), "range");
    expect(screen.getByLabelText("Monto mínimo")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto máximo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar compromiso" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: "candidate-1", cadence: "weekly", timingKind: "weekday", expectedDayOfWeek: "friday", amountMode: "range",
    }));
  });

  it("shows the Spanish saving state and observed-amount warning", () => {
    renderForm({ busy: true, model: { ...model, observedMedianAmount: null } });

    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
    expect(screen.getByText("El monto observado no se pudo cargar con precisión confiable de centavos. Actualiza antes de confirmar.")).toBeInTheDocument();
  });
});
