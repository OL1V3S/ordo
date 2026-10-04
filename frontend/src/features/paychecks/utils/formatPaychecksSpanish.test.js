import { afterEach, describe, expect, it } from "vitest";
import i18n, { resources } from "../../../shared/localization/i18n";
import { getPaycheckErrorMessage } from "../hooks/usePaychecks";
import { cadenceLabel, formatAmount, formatDate, formatMoney, formatSchedule, formatWindow } from "./formatPaychecks";
import { initialPaycheckForm, validatePaycheckForm } from "./paycheckForm";

const es = i18n.getFixedT("es", "paychecks");

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("paycheck display helpers in Spanish", () => {
  it("localizes labels while keeping date and money formats", () => {
    expect(cadenceLabel("biweekly", es)).toBe("Cada dos semanas");
    expect(cadenceLabel("unexpected", es)).toBe("Frecuencia desconocida");
    expect(formatSchedule({ cadence: "weekly", referenceAnchorDate: "2026-01-02" }, es)).toBe("Semanal, fecha de referencia Jan 2, 2026");
    expect(formatSchedule({ cadence: "monthly", firstMonthAnchor: { kind: "month_end", day: null } }, es)).toBe("Mensual, fin de mes");
    expect(formatSchedule({ cadence: "semimonthly", firstMonthAnchor: { kind: "day_of_month", day: 15 }, secondMonthAnchor: { kind: "month_end", day: null } }, es))
      .toBe("Dos veces al mes, día 15 y fin de mes");
    expect(formatSchedule(null, es)).toBe("Calendario no disponible");
    expect(formatWindow(1, 3, es)).toBe("1 día antes · 3 días después");
    expect(formatWindow(0, 1, es)).toBe("0 días antes · 1 día después");
    expect(formatDate("2026-03-08", es)).toBe("Mar 8, 2026");
    expect(formatDate("2026-02-29", es)).toBe("Fecha desconocida");
    expect(formatMoney(1234.56, es)).toBe("$1,234.56");
    expect(formatMoney(1e16, es)).toBe("El monto requiere revisión");
    expect(formatMoney(null, es)).toBe("Monto no disponible");
    expect(formatAmount({ mode: "range", minimumAmount: "100.01", maximumAmount: "200.99" }, es)).toBe("$100.01 – $200.99");
    expect(formatAmount(null, es)).toBe("Monto no disponible");
  });
});

describe("paycheck message catalogs", () => {
  it("has a Spanish and an English message for every code the form validator can return", () => {
    const manual = (overrides) => ({ ...initialPaycheckForm("manual"), displayName: "Pay", firstAnchorDay: "10", fixedAmount: "100", ...overrides });
    const forms = [
      manual({ displayName: "", cadence: "unexpected", windowBeforeDays: "9", windowAfterDays: "x", amountMode: "unexpected" }),
      manual({ cadence: "weekly", referenceAnchorDate: "" }),
      manual({ firstAnchorKind: "unexpected" }),
      manual({ firstAnchorDay: "" }),
      manual({ cadence: "semimonthly", firstAnchorDay: "1", secondAnchorKind: "month_end" }),
      manual({ amountMode: "range", minimumAmount: "100", maximumAmount: "100" }),
    ];
    const codes = new Set(forms.flatMap((form) => Object.values(validatePaycheckForm(form, "manual").errors)));
    expect([...codes].sort()).toEqual(Object.keys(resources.en.paychecks.form.errors).sort());
    for (const code of codes) {
      expect(resources.en.paychecks.form.errors[code]).toBeTruthy();
      expect(resources.es.paychecks.form.errors[code]).toBeTruthy();
    }
  });

  it("maps every known hook code to its Spanish message and unknown codes to the generic fallback", () => {
    for (const [code, message] of Object.entries(resources.es.paychecks.feedback.errors)) {
      const error = { response: { status: 422, data: { code } } };
      expect(getPaycheckErrorMessage(error, es)).toBe(message);
      expect(getPaycheckErrorMessage(error)).toBe(resources.en.paychecks.feedback.errors[code]);
    }
    const unknown = { response: { status: 422, data: { code: "__proto__" } } };
    expect(getPaycheckErrorMessage(unknown, es)).toBe(resources.es.paychecks.feedback.errors.request_failed);
    expect(getPaycheckErrorMessage({ response: { status: 401 } }, es)).toBe(resources.es.paychecks.feedback.errors.authentication_required);
    expect(getPaycheckErrorMessage({ response: { status: 404 } }, es)).toBe(resources.es.paychecks.feedback.errors.paycheck_not_found);
  });
});
