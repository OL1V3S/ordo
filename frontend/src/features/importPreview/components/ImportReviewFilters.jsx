import { useTranslation } from "react-i18next";
import { REVIEW_FILTERS } from "../utils/importReview";

// Row filters (radios: render-only, never change selection) and whole-batch bulk actions.
// Bulk buttons use aria-disabled so a running, empty or row-save-pending action never drops
// keyboard focus; only a hard lock (external task, confirming, stale review) uses the disabled
// attribute. A bulk action is one request, so the status region announces it once at the start
// and once at the end.
export default function ImportReviewFilters({
  filter,
  counts,
  shown,
  total,
  hardLocked,
  bulkRunning,
  rowSavePending = false,
  bulkProgress,
  bulkMessage,
  selectableCount,
  selectedCount,
  onFilterChange,
  onSelectAll,
  onClear,
}) {
  const { t } = useTranslation("importPreview");
  const inert = (handler, unavailable) => (event) => {
    if (bulkRunning || rowSavePending || unavailable) {
      event.preventDefault();
      return;
    }
    handler();
  };
  const selectAllUnavailable = selectableCount === 0;
  const clearUnavailable = selectedCount === 0;

  return (
    <div className="import-review-controls">
      <fieldset className="import-review-filters">
        <legend>{t("filters.legend")}</legend>
        <div className="import-review-filters__options">
          {REVIEW_FILTERS.map((key) => (
            <label className="import-review-filters__option" key={key}>
              <input
                type="radio"
                name="import-review-filter"
                value={key}
                checked={filter === key}
                onChange={() => onFilterChange(key)}
              />
              <span>{t("filters.option", { label: t(`filters.${key}`), count: counts[key] ?? 0 })}</span>
            </label>
          ))}
        </div>
        <p className="muted import-review-filters__showing">
          {t("filters.showing", { shown, count: total })}
        </p>
      </fieldset>

      <div className="import-review-bulk" role="group" aria-label={t("bulk.heading")}>
        <div className="import-review-bulk__actions">
          <button
            type="button"
            className="button-ghost"
            disabled={hardLocked}
            aria-disabled={!hardLocked && (bulkRunning || rowSavePending || selectAllUnavailable) ? "true" : undefined}
            aria-describedby="import-bulk-hint"
            onClick={inert(onSelectAll, selectAllUnavailable)}
          >
            {t("bulk.selectAll", { count: selectableCount })}
          </button>
          <button
            type="button"
            className="button-ghost"
            disabled={hardLocked}
            aria-disabled={!hardLocked && (bulkRunning || rowSavePending || clearUnavailable) ? "true" : undefined}
            onClick={inert(onClear, clearUnavailable)}
          >
            {t("bulk.clear")}
          </button>
        </div>
        <p id="import-bulk-hint" className="muted import-review-bulk__hint">{t("bulk.hint")}</p>
        <p className="import-review-bulk__status" role="status" aria-live="polite">
          {bulkRunning && bulkProgress
            ? t(bulkProgress.kind === "select" ? "bulk.selecting" : "bulk.clearing", { count: bulkProgress.count })
            : bulkMessage}
        </p>
      </div>
    </div>
  );
}
