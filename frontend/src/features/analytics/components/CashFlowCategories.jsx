import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { displayText } from "../../../utils/text";
import { categoryLabel } from "../../../shared/localization/categoryLabel";
import CashFlowCategoryDonut from "./CashFlowCategoryDonut";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { barWidth, cashPercentage, categoryShares, formatCash, sortCategories } from "../utils/cashFlowPresentation";

export default function CashFlowCategories({ data }) {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const headingId = useId();
  const categories = useMemo(() => sortCategories(data.categories), [data]);
  const shares = useMemo(() => categoryShares(data.categories, data.selected.spentMinor), [data]);

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
        <>
        {shares.length > 0 && <CashFlowCategoryDonut shares={shares} spentMinor={data.selected.spentMinor} />}
        <ol className="analytics-list analytics-category-list">
          {categories.map((category) => (
            <li key={category.category} className="analytics-list__item">
              <div className="analytics-row">
                <strong>{categoryLabel(t, category.category, displayText)}</strong>
                <span>{formatCash(category.amountMinor, { locale })} · {cashPercentage(category.amountMinor, data.selected.spentMinor, locale) ?? t("categories.notApplicable")}</span>
              </div>
              <div className="analytics-bar" aria-hidden="true">
                <span style={{ width: barWidth(category.amountMinor, data.selected.spentMinor) }} />
              </div>
            </li>
          ))}
        </ol>
        </>
      )}
    </section>
  );
}
