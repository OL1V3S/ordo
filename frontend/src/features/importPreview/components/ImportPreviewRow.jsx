import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { displayText } from "../../../utils/text";

const STATUS_LABELS = {
  expense_candidate: "Expense candidate",
  non_expense: "Incoming deposit",
  needs_review: "Needs review",
  invalid: "Invalid row",
};

const CONFIRMATION_CODE_MESSAGES = {
  possible_duplicate: "New possible duplicate — review this row and explicitly select it again if it should be imported.",
  possible_inflow_duplicate: "New possible incoming-deposit duplicate — review this row and explicitly select it again if it should be saved.",
  row_not_selectable: "This row is not eligible for the requested import selection.",
  date_required: "A transaction date is required.",
  amount_must_be_positive: "The expense amount must be positive.",
  amount_out_of_range: "The expense amount is outside the supported range.",
  amount_precision_invalid: "The expense amount must use no more than two decimal places.",
  description_required: "A description is required.",
  description_too_long: "The description is too long.",
  category_required: "An expense category is required.",
  category_too_long: "The expense category is too long.",
  category_reserved: "Choose a category other than Other.",
};

function RowFields({ row, draft, disabled, onDraftChange, onSave }) {
  if (!row.isEligible) return <span className="muted">Not editable</span>;

  const saveStatus = draft.pending
    ? "Saving…"
    : draft.outcome === "error"
      ? draft.dirty ? "Save failed. Changes remain unsaved." : "The row update failed. Try again."
      : draft.dirty
        ? "Unsaved changes"
        : draft.outcome === "saved" ? "Saved" : "";

  return (
    <div className="import-row-fields">
      <label>
        <span>Expense description</span>
        <input
          value={draft.description}
          disabled={disabled || draft.pending}
          onChange={(event) => onDraftChange({ description: event.target.value })}
        />
      </label>
      <label>
        <span>Category</span>
        <select
          value={draft.categoryChoice}
          disabled={disabled || draft.pending}
          onChange={(event) => onDraftChange({ categoryChoice: event.target.value })}
        >
          {DEFAULT_CATEGORIES.map((category) => (
            <option key={category} value={category.toLowerCase()}>{displayText(category)}</option>
          ))}
          <option value="uncategorized">Uncategorized</option>
          <option value="other">Other</option>
        </select>
      </label>
      {draft.categoryChoice === "other" && (
        <label>
          <span>Custom category</span>
          <input
            value={draft.customCategory}
            disabled={disabled || draft.pending}
            onChange={(event) => onDraftChange({ customCategory: event.target.value })}
          />
        </label>
      )}
      <button
        type="button"
        className="button-ghost"
        disabled={disabled || draft.pending || !draft.dirty}
        onClick={onSave}
      >
        {draft.pending ? "Saving…" : "Save row"}
      </button>
      {saveStatus && (
        <span
          className={draft.outcome === "error" ? "import-save-status import-save-status--error" : "import-save-status"}
          role={draft.outcome === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {saveStatus}
        </span>
      )}
    </div>
  );
}

function RowStatus({ row, confirmationCodes }) {
  return (
    <div className="import-row-status">
      <span className={`import-status import-status--${row.classification}`}>
        {STATUS_LABELS[row.classification] ?? "Review required"}
      </span>
      {row.isPossibleDuplicate && (
        <span className="import-warning">Possible duplicate — review before selecting</span>
      )}
      {row.isPossibleInflowDuplicate && (
        <span className="import-warning">Possible incoming-deposit duplicate — review before saving</span>
      )}
      {row.errors.map((code) => <span className="import-error" key={code}>Issue: {code.replaceAll("_", " ")}</span>)}
      {row.warnings.filter((code) =>
        code !== "possible_duplicate" && code !== "possible_inflow_duplicate").map((code) => (
        <span className="import-warning" key={code}>Warning: {code.replaceAll("_", " ")}</span>
      ))}
      {confirmationCodes.map((code) => (
        <span
          className={code === "possible_duplicate" || code === "possible_inflow_duplicate"
            ? "import-warning"
            : "import-error"}
          key={`confirmation-${code}`}
        >
          {CONFIRMATION_CODE_MESSAGES[code]}
        </span>
      ))}
    </div>
  );
}

export default function ImportPreviewRow({
  row,
  draft,
  confirmationCodes = [],
  disabled = false,
  onDraftChange,
  onSave,
  onSelectionChange,
  presentation = "table",
}) {
  const isInflow = row.isInflowEligible;
  const isSelectable = row.isEligible || isInflow;
  const isSelected = row.isEligible ? row.selectedForImport : row.selectedForInflow;
  const selection = (
    <label className="import-selection">
      <input
        type="checkbox"
        checked={Boolean(isSelected)}
        disabled={!isSelectable || disabled || draft.pending}
        onChange={(event) => onSelectionChange(event.target.checked)}
      />
      <span>{row.isEligible
        ? "Select for import"
        : isInflow
          ? "Save incoming deposit as inflow evidence"
          : "Not selectable"}</span>
    </label>
  );

  const details = (
    <>
      <div><span className="import-field-label">Date</span>{row.postedDate ?? "Unavailable"}</div>
      <div><span className="import-field-label">Amount</span>{row.amount == null ? "Unavailable" : `$${Number(row.amount).toFixed(2)}`}</div>
      <div><span className="import-field-label">Direction</span>{displayText(row.direction)}</div>
      <div><span className="import-field-label">Source</span>{row.sourceDescription || "Unavailable"}</div>
      <div><span className="import-field-label">Section</span>{displayText(row.sourceSection)}</div>
      {isInflow && (
        <div className="muted">Saving this deposit records account inflow evidence. It does not classify it as income or a paycheck.</div>
      )}
    </>
  );

  const fields = (
    <RowFields
      row={row}
      draft={draft}
      disabled={disabled}
      onDraftChange={onDraftChange}
      onSave={onSave}
    />
  );

  if (presentation === "card") {
    return (
      <article className="import-preview-card" aria-label={`Statement row ${row.sourceRowOrdinal}`}>
        <div className="import-preview-card__details">{details}</div>
        <RowStatus row={row} confirmationCodes={confirmationCodes} />
        {selection}
        {fields}
      </article>
    );
  }

  return (
    <tr>
      <td>{row.sourceRowOrdinal}</td>
      <td>{details}</td>
      <td><RowStatus row={row} confirmationCodes={confirmationCodes} /></td>
      <td>{selection}</td>
      <td>{fields}</td>
    </tr>
  );
}
