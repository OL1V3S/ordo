import { useTranslation } from "react-i18next";
import { REVIEW_FILTERS } from "../utils/importReview";

// Row filters (radios: render-only, never change selection) and whole-batch bulk actions.
// Bulk buttons use aria-disabled so a running or empty action never drops keyboard focus;
// only a hard lock (external task, confirming, stale review) uses the disabled attribute.
export default function ImportReviewFilters({
  filter,
  counts,
  shown,
  total,
  hardLocked,
  bulkRunning,
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
    if (bulkRunning || unavailable) {
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
        <p className="muted import-review-filters__showing" role="status" aria-live="polite">
          {t("filters.showing", { shown, count: total })}
        </p>
      </fieldset>

      <div className="import-review-bulk" role="group" aria-label={t("bulk.heading")}>
        <div className="import-review-bulk__actions">
          <button
            type="button"
            className="button-ghost"
            disabled={hardLocked}
            aria-disabled={!hardLocked && (bulkRunning || selectAllUnavailable) ? "true" : undefined}
            aria-describedby="import-bulk-hint"
            onClick={inert(onSelectAll, selectAllUnavailable)}
          >
            {t("bulk.selectAll", { count: selectableCount })}
          </button>
          <button
            type="button"
            className="button-ghost"
            disabled={hardLocked}
            aria-disabled={!hardLocked && (bulkRunning || clearUnavailable) ? "true" : undefined}
            onClick={inert(onClear, clearUnavailable)}
          >
            {t("bulk.clear")}
          </button>
        </div>
        <p id="import-bulk-hint" className="muted import-review-bulk__hint">{t("bulk.hint")}</p>
        <p className="import-review-bulk__status" role="status" aria-live="polite">
          {bulkRunning && bulkProgress
            ? t("bulk.progress", { done: bulkProgress.done, total: bulkProgress.total })
            : bulkMessage}
        </p>
      </div>
    </div>
  );
}
