import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FormField from "../../../shared/ui/FormField";
import { CADENCES, initialPaycheckForm, isUnsafeNumericAmount, validatePaycheckForm } from "../utils/paycheckForm";
import { cadenceLabel, formatSchedule } from "../utils/formatPaychecks";

export default function PaycheckForm({ mode, model, busy = false, submitDisabled = false, onSubmit, onCancel, formId }) {
  const { t } = useTranslation("paychecks");
  const generatedId = useId();
  const [form, setForm] = useState(() => initialPaycheckForm(mode, model));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const formRef = useRef(null);
  const pending = useRef(false);
  const disabled = busy || submitting;
  const variable = mode === "confirm" && model?.observedAmount?.mode === "variable";
  const sourceAmount = mode === "confirm" ? model?.observedAmount : model?.amount;
  const amountNeedsReview = Object.values(sourceAmount ?? {}).some(isUnsafeNumericAmount);
  const submitLabel = t(`form.submit.${mode}`);

  useEffect(() => { formRef.current?.querySelector("input")?.focus(); }, []);
  useEffect(() => {
    if (Object.keys(errors).length) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function update(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "cadence") Object.assign(next, { referenceAnchorDate: "", firstAnchorKind: "day_of_month",
        firstAnchorDay: "", secondAnchorKind: "day_of_month", secondAnchorDay: "" });
      if (name === "firstAnchorKind") next.firstAnchorDay = "";
      if (name === "secondAnchorKind") next.secondAnchorDay = "";
      if (name === "amountMode") Object.assign(next, { fixedAmount: "", minimumAmount: "", maximumAmount: "" });
      return next;
    });
    setErrors({});
    setSubmitError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (disabled || submitDisabled || pending.current) return;
    const result = validatePaycheckForm(form, mode, model);
    setErrors(result.errors);
    if (!result.payload) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError("");
    try { await onSubmit(result.payload); }
    catch { setSubmitError("form.submitError"); }
    finally { pending.current = false; setSubmitting(false); }
  }

  function field(name, label, options = {}) {
    const { choices, ...inputProps } = options;
    const errorId = `${generatedId}-${name}-error`;
    return <div className="paycheck-form__field" key={name}><FormField label={label}>{(id) => <>
      {choices ? <select id={id} value={form[name]} onChange={(event) => update(name, event.target.value)}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? errorId : undefined}>
        {choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select> : <input id={id} value={form[name]} onChange={(event) => update(name, event.target.value)}
        required aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? errorId : undefined} {...inputProps} />}
    </>}</FormField>{errors[name] && <span className="paycheck-form__error" id={errorId}>{t(`form.errors.${errors[name]}`)}</span>}</div>;
  }

  function anchorFields(prefix, labelKey) {
    return <>
      {field(`${prefix}AnchorKind`, t(`form.fields.${labelKey}`), { choices: [["day_of_month", t("form.anchorKinds.dayOfMonth")], ["month_end", t("form.anchorKinds.monthEnd")]] })}
      {form[`${prefix}AnchorKind`] === "day_of_month" && field(`${prefix}AnchorDay`, t(`form.fields.${labelKey}Day`), { inputMode: "numeric" })}
    </>;
  }

  return <form id={formId ?? generatedId} ref={formRef} className="paycheck-form" aria-label={submitLabel}
    aria-busy={disabled} onSubmit={handleSubmit} noValidate>
    {mode === "manual" && <p className="paycheck-form__note">{t("form.manualNote")}</p>}
    {mode !== "manual" && <div className="paycheck-form__schedule">
      <strong>{t("form.scheduleHeading")}</strong><p>{formatSchedule(model?.schedule, t)}</p>
      <p>{mode === "confirm" ? t("form.confirmScheduleNote") : t("form.editScheduleNote")}</p>
    </div>}
    {variable && <p className="paycheck-form__note">{t("form.variableNote")}</p>}
    {amountNeedsReview && <p className="paycheck-form__note">{t("form.unsafeAmountNote")}</p>}
    {Object.keys(errors).length > 0 && <p className="paycheck-form__error" role="alert">{t("form.checkFields")}</p>}
    {submitError && <p className="paycheck-form__error" role="alert">{t(submitError)}</p>}
    <fieldset className="paycheck-form__fields" disabled={disabled}>
      <legend className="sr-only">{t("form.legend")}</legend>
      <div className="paycheck-form__grid">
        {field("displayName", t("form.fields.displayName"), { maxLength: 500 })}
        {mode === "manual" && <>
          {field("cadence", t("form.fields.cadence"), { choices: CADENCES.map((cadence) => [cadence, cadenceLabel(cadence, t)]) })}
          {["weekly", "biweekly"].includes(form.cadence)
            ? field("referenceAnchorDate", t("form.fields.referenceAnchorDate"), { type: "date", min: "0001-01-01", max: "9999-12-31" })
            : <>{anchorFields("first", form.cadence === "monthly" ? "monthlyAnchor" : "firstAnchor")}
              {form.cadence === "semimonthly" && anchorFields("second", "secondAnchor")}</>}
        </>}
        {field("windowBeforeDays", t("form.fields.windowBeforeDays"), { inputMode: "numeric" })}
        {field("windowAfterDays", t("form.fields.windowAfterDays"), { inputMode: "numeric" })}
        {field("amountMode", t("form.fields.amountMode"), { choices: variable ? [["range", t("form.amountModes.range")]]
          : [["fixed", t("form.amountModes.fixed")], ["range", t("form.amountModes.range")]] })}
        {form.amountMode === "fixed" ? field("fixedAmount", t("form.fields.fixedAmount"), { inputMode: "decimal" }) : <>
          {field("minimumAmount", t("form.fields.minimumAmount"), { inputMode: "decimal" })}
          {field("maximumAmount", t("form.fields.maximumAmount"), { inputMode: "decimal" })}
        </>}
      </div>
    </fieldset>
    <div className="paycheck-form__actions inline-actions">
      <button type="submit" disabled={disabled || submitDisabled}>{disabled ? t("form.saving") : submitLabel}</button>
      <button type="button" className="button-ghost" disabled={disabled} onClick={onCancel}>{t("form.cancel")}</button>
    </div>
  </form>;
}
