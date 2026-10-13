import { useTranslation } from "react-i18next";
import { categoryLabel } from "../../../shared/localization/categoryLabel";
import { formatCalendarDate, formatMoneyDecimal } from "../../../shared/localization/format";
import { useLocale } from "../../../shared/localization/useLocale";
import { displayText } from "../../../utils/text";
import { formatTotal, savedRowsMatchConfirmation, totalsFromSavedRows } from "../utils/importReview";

function SavedRow({ kind, row, locale }) {
  const { t } = useTranslation("importPreview");
  const { t: ta } = useTranslation("activity");
  const date = formatCalendarDate(row.postedDate, locale) ?? t("row.unavailable");
  const amount = row.amount == null ? null : formatMoneyDecimal(row.amount, locale);
  const category = kind === "expense" && row.category
    ? categoryLabel(ta, row.category, displayText)
    : null;
  return (
    <li className="import-saved-row">
      <strong className="import-saved-row__description">{row.description || t("row.unavailable")}</strong>
      <span className="import-saved-row__meta">
        {[t(`saved.${kind}`), date, category, amount ?? t("row.unavailable")].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}

// Rendered outside the polite completion live region so a screen reader is not asked to read
// up to 1000 rows. The list is the last-known state of this tab, guarded by the confirm counts.
export default function ImportResults({ confirmation, savedRows, onViewActivity, onDone }) {
  const { t } = useTranslation("importPreview");
  const { locale } = useLocale();
  const alreadyConfirmed = confirmation.status === "already_confirmed";
  const listAvailable = !alreadyConfirmed && savedRowsMatchConfirmation(savedRows, confirmation);
  const totals = listAvailable ? totalsFromSavedRows(savedRows) : null;
  const total = (kind) => formatTotal(t, totals[`${kind}Cents`], locale);

  return (
    <div className="import-saved">
      {listAvailable && (savedRows.expenses.length > 0 || savedRows.deposits.length > 0) && (
        <section className="import-saved__list" aria-labelledby="import-saved-heading">
          <h4 id="import-saved-heading" className="h3">{t("saved.heading")}</h4>
          {savedRows.expenses.length > 0 && (
            <p className="import-saved__total">{t("saved.expenseTotal", { count: savedRows.expenses.length, total: total("expense") })}</p>
          )}
          {savedRows.deposits.length > 0 && (
            <p className="import-saved__total">{t("saved.depositTotal", { count: savedRows.deposits.length, total: total("deposit") })}</p>
          )}
          <ul className="import-saved-rows">
            {savedRows.expenses.map((row) => <SavedRow key={row.rowId} kind="expense" row={row} locale={locale} />)}
            {savedRows.deposits.map((row) => <SavedRow key={row.rowId} kind="deposit" row={row} locale={locale} />)}
          </ul>
        </section>
      )}
      {!alreadyConfirmed && !listAvailable && <p className="muted">{t("saved.unavailable")}</p>}
      <div className="inline-actions import-saved__actions">
        {onViewActivity && <button type="button" onClick={onViewActivity}>{t("saved.viewActivity")}</button>}
        <button type="button" className="button-ghost" onClick={onDone}>{t("saved.done")}</button>
      </div>
    </div>
  );
}
