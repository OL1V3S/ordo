import { useTranslation } from "react-i18next";

const ITEMS = [
  ["expensesSelected", "expensesSelected"],
  ["depositsSelected", "depositsSelected"],
  ["possibleDuplicates", "possibleDuplicates"],
  ["needsReview", "needsReview"],
  ["cannotBeSelected", "cannotBeSelected"],
];

// Counts always cover the whole statement, never just the rows visible under a filter.
export default function ImportReviewSummary({ summary }) {
  const { t } = useTranslation("importPreview");
  return (
    <section className="import-review-summary" aria-labelledby="import-review-summary-heading">
      <h4 className="import-review-summary__heading" id="import-review-summary-heading">{t("summary.heading")}</h4>
      <dl className="import-review-summary__list">
        {ITEMS.map(([key, field]) => (
          <div className="import-review-summary__item" key={key}>
            <dt>{t(`summary.${key}`)}</dt>
            <dd>{summary[field]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
