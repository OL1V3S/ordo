import { useState } from "react";
import FormField from "../../../shared/ui/FormField";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function initialForm(model) {
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
    expectedAmount: (model.expectedAmount ?? (model.observedAmountMode === "fixed" ? model.observedMedianAmount : null))?.toString() ?? "",
    expectedMinimumAmount: (model.expectedMinimumAmount ?? model.observedMinimumAmount)?.toString() ?? "",
    expectedMaximumAmount: (model.expectedMaximumAmount ?? model.observedMaximumAmount)?.toString() ?? "",
  };
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

export default function CommitmentForm({ model, fingerprint, submitLabel, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => initialForm(model));

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateCadence(cadence) {
    setForm((current) => ({
      ...current,
      cadence,
      timingKind: cadence === "weekly" ? "weekday" : cadence === "yearly" ? "monthandday" : "dayofmonth",
      expectedDayOfWeek: cadence === "weekly" ? (current.expectedDayOfWeek || "monday") : "",
      expectedDay: cadence === "weekly" ? "" : (current.expectedDay || "1"),
      expectedMonth: cadence === "yearly" ? (current.expectedMonth || "1") : "",
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const isWeekly = form.cadence === "weekly";
    const isMonthly = form.cadence === "monthly";
    const isMonthEnd = isMonthly && form.timingKind === "monthend";
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
      expectedAmount: form.amountMode === "fixed" ? numberOrNull(form.expectedAmount) : null,
      expectedMinimumAmount: form.amountMode === "range" ? numberOrNull(form.expectedMinimumAmount) : null,
      expectedMaximumAmount: form.amountMode === "range" ? numberOrNull(form.expectedMaximumAmount) : null,
    };
    onSubmit(payload);
  }

  return (
    <form className="commitment-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <FormField label="Name">{(id) => <input id={id} required maxLength="500" value={form.name} onChange={(event) => update("name", event.target.value)} />}</FormField>
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
          <FormField label="Expected amount">{(id) => <input id={id} type="number" required min="0.01" step="0.01" value={form.expectedAmount} onChange={(event) => update("expectedAmount", event.target.value)} />}</FormField>
        ) : (
          <>
            <FormField label="Minimum amount">{(id) => <input id={id} type="number" required min="0.01" step="0.01" value={form.expectedMinimumAmount} onChange={(event) => update("expectedMinimumAmount", event.target.value)} />}</FormField>
            <FormField label="Maximum amount">{(id) => <input id={id} type="number" required min="0.01" step="0.01" value={form.expectedMaximumAmount} onChange={(event) => update("expectedMaximumAmount", event.target.value)} />}</FormField>
          </>
        )}
      </div>
      <div className="inline-actions commitment-form__actions">
        <button type="submit" disabled={busy}>{busy ? "Saving..." : submitLabel}</button>
        <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
