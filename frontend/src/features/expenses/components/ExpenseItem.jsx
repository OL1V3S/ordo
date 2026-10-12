import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import RowActionsMenu from "../../activity/components/RowActionsMenu";
import { displayText } from "../../../utils/text";
import { formatExpenseDate } from "../utils/calendarDate";
import { formatExactMoney, parseExpenseAmount } from "../utils/exactMoney";

// Read-only row. `rowActions` (the timeline adapter) adds the "…" menu only in the
// timeline-failure fallback.
export default function ExpenseItem({ expense, rowActions = null }) {
  const { t } = useTranslation("activity");
  const { locale } = useLocale();
  const amountIsExact = Boolean(parseExpenseAmount(expense.amount));
  const date = formatExpenseDate(expense.date, locale);
  const item = { kind: "expense", recordId: expense.id };

  return (
    <tr className="expense-row">
      <td className="expense-cell expense-cell--description" data-label={t("expenseList.columns.description")}>{displayText(expense.description)}</td>
      <td className="expense-cell expense-cell--amount" data-label={t("expenseList.columns.amount")}>
        {amountIsExact ? formatExactMoney(expense.amount, { currency: false }, locale) : t("expenseItem.amountReview")}
      </td>
      <td className="expense-cell expense-cell--date" data-label={t("expenseList.columns.date")}>{date}</td>
      <td className="expense-cell expense-cell--category" data-label={t("expenseList.columns.category")}>{displayText(expense.category)}</td>
      {rowActions && <td className="expense-cell expense-cell--actions" data-label={t("expenseList.columns.actions")}>
        <RowActionsMenu kind="expense" labelValues={{ description: displayText(expense.description), date, id: expense.id }}
          state={rowActions.getState(item)} onEdit={(opener) => rowActions.onEdit(item, opener)} onDelete={(opener) => rowActions.onDelete(item, opener)} />
      </td>}
    </tr>
  );
}
