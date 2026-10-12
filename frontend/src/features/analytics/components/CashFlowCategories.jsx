import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { displayText } from "../../../utils/text";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { barWidth, cashPercentage, formatCash, minorUnits } from "../utils/cashFlowPresentation";

export default function CashFlowCategories({ data }) {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const headingId = useId();
  const categories = useMemo(() => [...(data.categories ?? [])].sort((left, right) => {
    const difference = minorUnits(right.amountMinor) - minorUnits(left.amountMinor);
    return difference > 0n ? 1 : difference < 0n ? -1 : left.category.localeCompare(right.category, "en");
  }), [data]);

  return (
    <section className="analytics-panel cash-flow-categories" aria-labelledby={headingId}>
      <div className="analytics-panel__header">
        <div>
          <p className="analytics-kicker">{t("categories.kicker")}</p>
          <h2 id={headingId} className="h2">{t("categories.heading")}</h2>
        </div>
      </div>
      {categories.length === 0 ? (
        <StatusMessage>{t("categories.empty")}</StatusMessage>
      ) : (
        <ol className="analytics-list analytics-category-list">
          {categories.map((category) => (
            <li key={category.category} className="analytics-list__item">
              <div className="analytics-row">
                <strong>{displayText(category.category)}</strong>
                <span>{formatCash(category.amountMinor, { locale })} · {cashPercentage(category.amountMinor, data.selected.spentMinor, locale) ?? t("categories.notApplicable")}</span>
              </div>
              <div className="analytics-bar" aria-hidden="true">
                <span style={{ width: barWidth(category.amountMinor, data.selected.spentMinor) }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
