import { useTranslation } from "react-i18next";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { displayText } from "../../../utils/text";

const STATUS_CODES = ["expense_candidate", "non_expense", "needs_review", "invalid"];
const DUPLICATE_CODES = ["possible_duplicate", "possible_inflow_duplicate"];

// Known codes use catalog text; anything else falls back to a readable form of the raw code.
function codeText(t, group, code) {
  return t(`row.${group}.${code}`, { defaultValue: code.replaceAll("_", " ") });
}

function RowFields({ row, rowContext, draft, disabled, onDraftChange, onSave }) {
  const { t } = useTranslation("importPreview");
  const { t: ta } = useTranslation("activity");
  if (!row.isEligible) return <span className="muted">{t("row.fields.notEditable")}</span>;

  const saveStatus = draft.pending
    ? t("row.fields.saving")
    : draft.outcome === "error"
      ? draft.dirty ? t("row.fields.saveFailedDirty") : t("row.fields.saveFailed")
      : draft.dirty
        ? t("row.fields.unsaved")
        : draft.outcome === "saved" ? t("row.fields.saved") : "";

  return (
    <div className="import-row-fields">
      <label>
        <span>{t("row.fields.description")}</span>
        <input
          aria-label={t("row.fields.descriptionAria", { row: rowContext })}
          value={draft.description}
          disabled={disabled || draft.pending}
          onChange={(event) => onDraftChange({ description: event.target.value })}
        />
      </label>
      <label>
        <span>{t("row.fields.category")}</span>
        <select
          aria-label={t("row.fields.categoryAria", { row: rowContext })}
          value={draft.categoryChoice}
          disabled={disabled || draft.pending}
          onChange={(event) => onDraftChange({ categoryChoice: event.target.value })}
        >
          {DEFAULT_CATEGORIES.map((category) => (
            <option key={category} value={category.toLowerCase()}>{ta(`categories.${category.toLowerCase()}`)}</option>
          ))}
          <option value="uncategorized">{t("row.fields.uncategorized")}</option>
          <option value="other">{ta("categories.other")}</option>
        </select>
      </label>
      {draft.categoryChoice === "other" && (
        <label>
          <span>{t("row.fields.customCategory")}</span>
          <input
            aria-label={t("row.fields.customCategoryAria", { row: rowContext })}
            value={draft.customCategory}
            disabled={disabled || draft.pending}
            onChange={(event) => onDraftChange({ customCategory: event.target.value })}
          />
        </label>
      )}
      <button
        type="button"
        className="button-ghost"
        aria-label={t("row.fields.saveRowAria", { row: rowContext })}
        disabled={disabled || draft.pending || !draft.dirty}
        onClick={onSave}
      >
        {draft.pending ? t("row.fields.saving") : t("row.fields.saveRow")}
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
  const { t } = useTranslation("importPreview");
  return (
    <div className="import-row-status">
      <span className={`import-status import-status--${row.classification}`}>
        {t(`row.statusLabels.${STATUS_CODES.includes(row.classification) ? row.classification : "default"}`)}
      </span>
      {row.isPossibleDuplicate && (
        <span className="import-warning">{t("row.possibleDuplicate")}</span>
      )}
      {row.isPossibleInflowDuplicate && (
        <span className="import-warning">{t("row.possibleInflowDuplicate")}</span>
      )}
      {row.errors.map((code) => <span className="import-error" key={code}>{t("row.issue", { detail: codeText(t, "errorCodes", code) })}</span>)}
      {row.warnings.filter((code) => !DUPLICATE_CODES.includes(code)).map((code) => (
        <span className="import-warning" key={code}>{t("row.warning", { detail: code.replaceAll("_", " ") })}</span>
      ))}
      {confirmationCodes.map((code) => (
        <span
          className={DUPLICATE_CODES.includes(code)
            ? "import-warning"
            : "import-error"}
          key={`confirmation-${code}`}
        >
          {t(`row.confirmationCodes.${code}`, { defaultValue: t("row.issue", { detail: code.replaceAll("_", " ") }) })}
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
}) {
  const { t } = useTranslation("importPreview");
  const isInflow = row.isInflowEligible;
  const isSelectable = row.isEligible || isInflow;
  const isSelected = row.isEligible ? row.selectedForImport : row.selectedForInflow;
  const sourceDescription = row.sourceDescription || t("row.unavailable");
  const rowContext = t("row.context", {
    description: sourceDescription,
    date: row.postedDate ?? t("row.unknownDate"),
    ordinal: row.sourceRowOrdinal,
  });
  const sourceDetailsLabel = t("row.sourceDetails.aria", { row: rowContext });
  const selectionKind = row.isEligible ? "select" : isInflow ? "deposit" : "notSelectable";
  const selection = (
    <label className="import-selection">
      <input
        type="checkbox"
        aria-label={t(`row.${selectionKind}Aria`, { row: rowContext })}
        checked={Boolean(isSelected)}
        disabled={!isSelectable || disabled || draft.pending}
        onChange={(event) => onSelectionChange(event.target.checked)}
      />
      <span>{t(`row.${selectionKind}Label`)}</span>
    </label>
  );

  const transaction = (
    <div className="import-row-transaction">
      <strong className="import-row-transaction__description">{sourceDescription}</strong>
      <div className="import-row-transaction__facts">
        <div><span className="import-field-label">{t("row.facts.date")}</span>{row.postedDate ?? t("row.unavailable")}</div>
        <div><span className="import-field-label">{t("row.facts.amount")}</span>{row.amount == null ? t("row.unavailable") : `$${Number(row.amount).toFixed(2)}`}</div>
        <div><span className="import-field-label">{t("row.facts.direction")}</span>{row.direction ? t(`row.directions.${row.direction}`, { defaultValue: displayText(row.direction) }) : ""}</div>
      </div>
      {isInflow && (
        <p className="muted import-row-transaction__qualification">
          {t("row.qualification")}
        </p>
      )}
      <details className="import-row-source-details">
        <summary aria-label={sourceDetailsLabel}>{t("row.sourceDetails.summary")}</summary>
        <div><span className="import-field-label">{t("row.sourceDetails.row")}</span>{row.sourceRowOrdinal}</div>
        <div><span className="import-field-label">{t("row.sourceDetails.section")}</span>{row.sourceSection ? t(`row.sections.${row.sourceSection}`, { defaultValue: displayText(row.sourceSection.replaceAll("_", " ")) }) : ""}</div>
      </details>
    </div>
  );

  return (
    <tr className="import-preview-row">
      <td className="import-preview-row__transaction" data-label={t("columns.transaction")}>{transaction}</td>
      <td className="import-preview-row__status" data-label={t("columns.status")}>
        <RowStatus row={row} confirmationCodes={confirmationCodes} />
      </td>
      <td className="import-preview-row__selection" data-label={t("columns.selection")}>{selection}</td>
      <td className="import-preview-row__fields" data-label={t("columns.fields")}>
        <RowFields
          row={row}
          rowContext={rowContext}
          draft={draft}
          disabled={disabled}
          onDraftChange={onDraftChange}
          onSave={onSave}
        />
      </td>
    </tr>
  );
}
