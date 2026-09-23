import { useEffect, useId, useRef } from "react";
import FormField from "../../../shared/ui/FormField";

const EDIT_WARNING = "Changes update recorded cash flow. If this entry supports a saved paycheck, that link stays and its recorded details update; the saved paycheck expectation stays unchanged.";

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
  const generatedId = useId();
  const formRef = useRef(null);
  const previousErrors = useRef("");
  const formLabel = mode === "edit" ? "Edit cash in" : (copy.title ?? "Add cash in");
  const submitLabel = mode === "edit" ? "Save changes" : (copy.save ?? "Add cash in");
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
      {mode === "edit" && <p className="inflow-form__warning">{EDIT_WARNING}</p>}
      {amountNeedsReview && (
        <p className="inflow-form__warning">
          <strong>Amount needs review.</strong> Enter the exact amount again before saving.
        </p>
      )}
      {errorSignature && <p className="inflow-form__error" role="alert">{copy.checkFields ?? "Check the highlighted fields."}</p>}

      <fieldset className="inflow-form__fields" disabled={pending}>
        <legend className="sr-only">{copy.detailsLegend ?? "Cash-in details"}</legend>
        <div className="inflow-form__grid">
          {field("description", copy.description ?? "Description")}
          {field("amount", copy.amount ?? "Amount", { inputMode: "decimal", autoComplete: "off" })}
          {field("date", copy.date ?? "Date", { type: "date", min: "0001-01-01", max: "9999-12-31" })}
        </div>
      </fieldset>

      <div className="inflow-form__actions inline-actions">
        <button type="submit" disabled={pending || disabled}>{pending ? (copy.saving ?? "Saving…") : submitLabel}</button>
        <button type="button" className="button-ghost" disabled={pending} onClick={onCancel}>{copy.cancel ?? "Cancel"}</button>
      </div>
    </form>
  );
}
