import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import FormField from "../../../shared/ui/FormField";

export default function InflowForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  pending = false,
  disabled = false,
  fieldErrors = {},
  mode = "create",
  amountNeedsReview = false,
  copy = {},
}) {
  const { t } = useTranslation("activity");
  const generatedId = useId();
  const formRef = useRef(null);
  const previousErrors = useRef("");
  const formLabel = mode === "edit" ? t("cashIn.form.editTitle") : (copy.title ?? t("cashIn.form.title"));
  const submitLabel = mode === "edit" ? t("cashIn.form.saveChanges") : (copy.save ?? t("cashIn.form.save"));
  const errorSignature = ["description", "amount", "date"]
    .filter((name) => fieldErrors[name])
    .map((name) => `${name}:${fieldErrors[name]}`)
    .join("|");

  useEffect(() => {
    formRef.current?.elements.description?.focus();
  }, []);

  useEffect(() => {
    if (errorSignature && errorSignature !== previousErrors.current) {
      formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    }
    previousErrors.current = errorSignature;
  }, [errorSignature]);

  function update(name, value) {
    onChange({ ...draft, [name]: value });
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!pending && !disabled) onSubmit();
  }

  function field(name, label, inputProps = {}) {
    const error = fieldErrors[name];
    const errorId = `${generatedId}-${name}-error`;

    return (
      <div className={`inflow-form__field inflow-form__field--${name}`}>
        <FormField label={label}>
          {(id) => (
            <input
              {...inputProps}
              id={id}
              name={name}
              value={draft[name]}
              onChange={(event) => update(name, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              required
            />
          )}
        </FormField>
        {error && <span className="inflow-form__error" id={errorId}>{error}</span>}
      </div>
    );
  }

  return (
    <form ref={formRef} className="inflow-form" aria-label={formLabel} aria-busy={pending} onSubmit={handleSubmit} noValidate>
      {mode === "edit" && <p className="inflow-form__warning">{t("cashIn.form.editWarning")}</p>}
      {amountNeedsReview && (
        <p className="inflow-form__warning">
          <strong>{t("cashIn.form.amountReviewTitle")}</strong>{" "}{t("cashIn.form.amountReviewBody")}
        </p>
      )}
      {errorSignature && <p className="inflow-form__error" role="alert">{copy.checkFields ?? t("cashIn.form.checkFields")}</p>}

      <fieldset className="inflow-form__fields" disabled={pending}>
        <legend className="sr-only">{copy.detailsLegend ?? t("cashIn.form.detailsLegend")}</legend>
        <div className="inflow-form__grid">
          {field("description", copy.description ?? t("cashIn.form.description"))}
          {field("amount", copy.amount ?? t("cashIn.form.amount"), { inputMode: "decimal", autoComplete: "off" })}
          {field("date", copy.date ?? t("cashIn.form.date"), { type: "date", min: "0001-01-01", max: "9999-12-31" })}
        </div>
      </fieldset>

      <div className="inflow-form__actions inline-actions">
        <button type="submit" disabled={pending || disabled}>{pending ? (copy.saving ?? t("cashIn.form.saving")) : submitLabel}</button>
        <button type="button" className="button-ghost" disabled={pending} onClick={onCancel}>{copy.cancel ?? t("cashIn.form.cancel")}</button>
      </div>
    </form>
  );
}
