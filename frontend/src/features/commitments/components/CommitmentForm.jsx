import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FormField from "../../../shared/ui/FormField";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { parseExpenseAmount } from "../../expenses/utils/exactMoney";
import { weekdayLabel } from "../utils/formatCommitments";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function initialForm(model) {
  const observed = (value) => parseExpenseAmount(value)?.value ?? "";
  return {
    name: model.name ?? model.description ?? "",
    category: model.category ?? "",
    cadence: model.cadence ?? "monthly",
    timingKind: model.timingKind ?? "dayofmonth",
    expectedDayOfWeek: model.expectedDayOfWeek ?? "monday",
    expectedDay: model.expectedDay?.toString() ?? "",
    expectedMonth: model.expectedMonth?.toString() ?? "",
    windowBeforeDays: model.windowBeforeDays?.toString() ?? "0",
    windowAfterDays: model.windowAfterDays?.toString() ?? "0",
    amountMode: model.amountMode ?? (model.observedAmountMode === "fixed" ? "fixed" : "range"),
    expectedAmount: model.expectedAmount?.toString()
      ?? (model.observedAmountMode === "fixed" ? observed(model.observedMedianAmount) : ""),
    expectedMinimumAmount: model.expectedMinimumAmount?.toString() ?? observed(model.observedMinimumAmount),
    expectedMaximumAmount: model.expectedMaximumAmount?.toString() ?? observed(model.observedMaximumAmount),
  };
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

export default function CommitmentForm({ model, fingerprint, submitLabel, busy, submitDisabled = false, initialDraft, onDraftChange, onSubmit, onCancel }) {
  const { t } = useTranslation("commitments");
  const [form, setForm] = useState(() => initialDraft ?? initialForm(model));
  const nameRef = useRef(null);
  const candidateObservedUnsafe = Boolean(fingerprint) && (
    (model.observedAmountMode === "fixed" && !parseExpenseAmount(model.observedMedianAmount))
    || (model.observedAmountMode !== "fixed"
      && (!parseExpenseAmount(model.observedMinimumAmount) || !parseExpenseAmount(model.observedMaximumAmount)))
  );
  useEffect(() => { nameRef.current?.focus(); }, []);

  function saveDraft(next) {
    setForm(next);
    onDraftChange?.(next);
  }

  function update(name, value) {
    saveDraft({ ...form, [name]: value });
  }

  function updateCadence(cadence) {
    saveDraft({
      ...form,
      cadence,
      timingKind: cadence === "weekly" ? "weekday" : cadence === "yearly" ? "monthandday" : "dayofmonth",
      expectedDayOfWeek: cadence === "weekly" ? (form.expectedDayOfWeek || "monday") : "",
      expectedDay: cadence === "weekly" ? "" : (form.expectedDay || "1"),
      expectedMonth: cadence === "yearly" ? (form.expectedMonth || "1") : "",
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const isWeekly = form.cadence === "weekly";
    const isMonthly = form.cadence === "monthly";
    const isMonthEnd = isMonthly && form.timingKind === "monthend";
    const exactCandidateAmount = (value) => {
      if (!fingerprint) return numberOrNull(value);
      return value === "" ? null : parseExpenseAmount(value)?.value ?? null;
    };
    const candidateAmountInvalid = candidateObservedUnsafe || (fingerprint && (form.amountMode === "fixed"
      ? !parseExpenseAmount(form.expectedAmount)
      : !parseExpenseAmount(form.expectedMinimumAmount) || !parseExpenseAmount(form.expectedMaximumAmount)));
    if (candidateAmountInvalid) return;
    const payload = {
      ...(fingerprint ? { fingerprint } : {}),
      name: form.name.trim(),
      category: form.category.trim(),
      cadence: form.cadence,
      timingKind: form.timingKind,
      expectedDayOfWeek: isWeekly ? form.expectedDayOfWeek : null,
      expectedDay: isWeekly || isMonthEnd ? null : numberOrNull(form.expectedDay),
      expectedMonth: form.cadence === "yearly" ? numberOrNull(form.expectedMonth) : null,
      windowBeforeDays: Number(form.windowBeforeDays),
      windowAfterDays: Number(form.windowAfterDays),
      amountMode: form.amountMode,
      expectedAmount: form.amountMode === "fixed" ? exactCandidateAmount(form.expectedAmount) : null,
      expectedMinimumAmount: form.amountMode === "range" ? exactCandidateAmount(form.expectedMinimumAmount) : null,
      expectedMaximumAmount: form.amountMode === "range" ? exactCandidateAmount(form.expectedMaximumAmount) : null,
    };
    onSubmit(payload);
  }

  return (
    <form className="commitment-form" aria-label={submitLabel} onSubmit={handleSubmit}>
      {candidateObservedUnsafe
        && <StatusMessage tone="warning">{t("form.observedAmountUnsafe")}</StatusMessage>}
      <fieldset className="form-grid commitment-form__fields" disabled={busy}>
        <FormField label={t("form.name")}>{(id) => <input ref={nameRef} id={id} required maxLength="500" value={form.name} onChange={(event) => update("name", event.target.value)} />}</FormField>
        <FormField label={t("form.category")}>{(id) => <input id={id} required maxLength="100" value={form.category} onChange={(event) => update("category", event.target.value)} />}</FormField>
        <FormField label={t("form.cadence")}>{(id) => <select id={id} value={form.cadence} onChange={(event) => updateCadence(event.target.value)}>
          <option value="weekly">{t("cadence.weekly")}</option>
          <option value="monthly">{t("cadence.monthly")}</option>
          <option value="yearly">{t("cadence.yearly")}</option>
        </select>}</FormField>

        {form.cadence === "weekly" && (
          <FormField label={t("form.expectedWeekday")}>{(id) => <select id={id} value={form.expectedDayOfWeek} onChange={(event) => update("expectedDayOfWeek", event.target.value)}>
            {WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{weekdayLabel(weekday, t)}</option>)}
          </select>}</FormField>
        )}

        {form.cadence === "monthly" && (
          <FormField label={t("form.monthlyTiming")}>{(id) => <select id={id} value={form.timingKind} onChange={(event) => update("timingKind", event.target.value)}>
            <option value="dayofmonth">{t("form.dayOfMonth")}</option>
            <option value="monthend">{t("form.monthEnd")}</option>
          </select>}</FormField>
        )}

        {form.cadence === "yearly" && (
          <FormField label={t("form.expectedMonth")}>{(id) => <input id={id} type="number" required min="1" max="12" value={form.expectedMonth} onChange={(event) => update("expectedMonth", event.target.value)} />}</FormField>
        )}

        {form.cadence !== "weekly" && !(form.cadence === "monthly" && form.timingKind === "monthend") && (
          <FormField label={t("form.expectedDay")}>{(id) => <input id={id} type="number" required min="1" max="31" value={form.expectedDay} onChange={(event) => update("expectedDay", event.target.value)} />}</FormField>
        )}

        <FormField label={t("form.daysBefore")}>{(id) => <input id={id} type="number" required min="0" step="1" value={form.windowBeforeDays} onChange={(event) => update("windowBeforeDays", event.target.value)} />}</FormField>
        <FormField label={t("form.daysAfter")}>{(id) => <input id={id} type="number" required min="0" step="1" value={form.windowAfterDays} onChange={(event) => update("windowAfterDays", event.target.value)} />}</FormField>
        <FormField label={t("form.amountModel")}>{(id) => <select id={id} value={form.amountMode} onChange={(event) => update("amountMode", event.target.value)}>
          <option value="fixed">{t("form.fixedAmount")}</option>
          <option value="range">{t("form.amountRange")}</option>
        </select>}</FormField>

        {form.amountMode === "fixed" ? (
          <FormField label={t("form.expectedAmount")}>{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedAmount} onChange={(event) => update("expectedAmount", event.target.value)} />}</FormField>
        ) : (
          <>
            <FormField label={t("form.minimumAmount")}>{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedMinimumAmount} onChange={(event) => update("expectedMinimumAmount", event.target.value)} />}</FormField>
            <FormField label={t("form.maximumAmount")}>{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedMaximumAmount} onChange={(event) => update("expectedMaximumAmount", event.target.value)} />}</FormField>
          </>
        )}
      </fieldset>
      <div className="inline-actions commitment-form__actions">
        <button type="submit" disabled={busy || submitDisabled || candidateObservedUnsafe}>{busy ? t("form.saving") : submitLabel}</button>
        <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>{t("form.cancel")}</button>
      </div>
    </form>
  );
}
