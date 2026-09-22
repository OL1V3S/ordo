import { useEffect, useRef, useState } from "react";
import FormField from "../../../shared/ui/FormField";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { parseExpenseAmount } from "../../expenses/utils/exactMoney";

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
        && <StatusMessage tone="warning">The observed amount could not be loaded with reliable cent precision. Refresh before confirming.</StatusMessage>}
      <fieldset className="form-grid commitment-form__fields" disabled={busy}>
        <FormField label="Name">{(id) => <input ref={nameRef} id={id} required maxLength="500" value={form.name} onChange={(event) => update("name", event.target.value)} />}</FormField>
        <FormField label="Category">{(id) => <input id={id} required maxLength="100" value={form.category} onChange={(event) => update("category", event.target.value)} />}</FormField>
        <FormField label="Cadence">{(id) => <select id={id} value={form.cadence} onChange={(event) => updateCadence(event.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>}</FormField>

        {form.cadence === "weekly" && (
          <FormField label="Expected weekday">{(id) => <select id={id} value={form.expectedDayOfWeek} onChange={(event) => update("expectedDayOfWeek", event.target.value)}>
            {WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{weekday[0].toUpperCase() + weekday.slice(1)}</option>)}
          </select>}</FormField>
        )}

        {form.cadence === "monthly" && (
          <FormField label="Monthly timing">{(id) => <select id={id} value={form.timingKind} onChange={(event) => update("timingKind", event.target.value)}>
            <option value="dayofmonth">Day of month</option>
            <option value="monthend">Month end</option>
          </select>}</FormField>
        )}

        {form.cadence === "yearly" && (
          <FormField label="Expected month">{(id) => <input id={id} type="number" required min="1" max="12" value={form.expectedMonth} onChange={(event) => update("expectedMonth", event.target.value)} />}</FormField>
        )}

        {form.cadence !== "weekly" && !(form.cadence === "monthly" && form.timingKind === "monthend") && (
          <FormField label="Expected day">{(id) => <input id={id} type="number" required min="1" max="31" value={form.expectedDay} onChange={(event) => update("expectedDay", event.target.value)} />}</FormField>
        )}

        <FormField label="Days before">{(id) => <input id={id} type="number" required min="0" step="1" value={form.windowBeforeDays} onChange={(event) => update("windowBeforeDays", event.target.value)} />}</FormField>
        <FormField label="Days after">{(id) => <input id={id} type="number" required min="0" step="1" value={form.windowAfterDays} onChange={(event) => update("windowAfterDays", event.target.value)} />}</FormField>
        <FormField label="Amount model">{(id) => <select id={id} value={form.amountMode} onChange={(event) => update("amountMode", event.target.value)}>
          <option value="fixed">Fixed amount</option>
          <option value="range">Amount range</option>
        </select>}</FormField>

        {form.amountMode === "fixed" ? (
          <FormField label="Expected amount">{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedAmount} onChange={(event) => update("expectedAmount", event.target.value)} />}</FormField>
        ) : (
          <>
            <FormField label="Minimum amount">{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedMinimumAmount} onChange={(event) => update("expectedMinimumAmount", event.target.value)} />}</FormField>
            <FormField label="Maximum amount">{(id) => <input id={id} type={fingerprint ? "text" : "number"} inputMode="decimal" required min="0.01" step="0.01" value={form.expectedMaximumAmount} onChange={(event) => update("expectedMaximumAmount", event.target.value)} />}</FormField>
          </>
        )}
      </fieldset>
      <div className="inline-actions commitment-form__actions">
        <button type="submit" disabled={busy || submitDisabled || candidateObservedUnsafe}>{busy ? "Saving..." : submitLabel}</button>
        <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
