import { useTranslation } from "react-i18next";
import ExpenseItem from "./ExpenseItem";
import Card from "../../../shared/ui/Card";

// Read-only table of every expense (recovery, check-your-records and timeline-failure states).
export default function ExpenseList({ expenses, rowActions = null }) {
  const { t } = useTranslation("activity");
  if (!expenses || expenses.length === 0) {
    return <p className="empty-state expense-list__empty">{t("expenseList.none")}</p>;
  }

  return (
    <Card className="section expense-list">
      <div className="table-wrapper expense-list__table-wrapper" role="region" aria-label={t("expenseList.tableLabel")} tabIndex="0">
        <table className="data-table expense-table">
          <caption className="sr-only">{t("expenseList.caption")}</caption>
          <thead>
            <tr>
              <th>{t("expenseList.columns.description")}</th>
              <th>{t("expenseList.columns.amount")}</th>
              <th>{t("expenseList.columns.date")}</th>
              <th>{t("expenseList.columns.category")}</th>
              {rowActions && <th>{t("expenseList.columns.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => <ExpenseItem key={expense.id} expense={expense} rowActions={rowActions} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
