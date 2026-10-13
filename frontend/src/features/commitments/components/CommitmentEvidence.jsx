import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { formatDate, formatDerivedMoney } from "../utils/formatCommitments";
import { displayText } from "../../../utils/text";
import { categoryLabel } from "../../../shared/localization/categoryLabel";

function sourceLabel(source, t) {
  return t(source === "sunflower_pdf" ? "evidence.sources.sunflower_pdf" : "evidence.sources.manual");
}

export default function CommitmentEvidence({ evidence, heading }) {
  const { t } = useTranslation("commitments");
  const { locale } = useLocale();
  return (
    <div className="commitment-evidence">
      <h4>{heading ?? t("evidence.heading")}</h4>
      <ul className="commitment-evidence__list">
        {evidence.map((expense) => (
          <li key={expense.expenseId} className="commitment-evidence__item">
            <div>
              <strong>{expense.description}</strong>
              <span>{formatDate(expense.date, t, locale)} · {categoryLabel(t, expense.category, displayText)}</span>
              <span>{sourceLabel(expense.source, t)}</span>
            </div>
            <strong>{formatDerivedMoney(expense.amount, locale, t("format.amountUnavailable"))}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
