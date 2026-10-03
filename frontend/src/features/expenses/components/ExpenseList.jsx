import { useTranslation } from "react-i18next";
import ExpenseItem from "./ExpenseItem";
import Card from "../../../shared/ui/Card";

export default function ExpenseList({
  expenses,
  totalCount,
  filteredCount,
  entriesPerPage,
  showAll,
  onShowAll,
  editingExpenseId,
  editingExpenseData,
  setEditingExpenseData,
  onStartEdit,
  onSave,
  onCancel,
  onDelete,
  busy = false,
  taskLocked = false,
  readUnavailable = false,
}) {
  const { t } = useTranslation("activity");
  if (!expenses || expenses.length === 0) {
    const hasRecordedExpenses = typeof totalCount === "number" && totalCount > 0;
    return (
      <p className="empty-state expense-list__empty">
        {hasRecordedExpenses ? t("expenseList.noMatches") : t("expenseList.none")}
      </p>
    );
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
              <th>{t("expenseList.columns.actions")}</th>
            </tr>
          </thead>

          <tbody>
            {expenses.map((expense, index) => (
              <ExpenseItem
                key={expense.id}
                expense={expense}
                rowNumber={index + 1}
                isEditing={editingExpenseId === expense.id}
                editingData={editingExpenseData}
                setEditingData={setEditingExpenseData}
                onStartEdit={onStartEdit}
                onSave={onSave}
                onCancel={onCancel}
                onDelete={onDelete}
                busy={busy}
                taskLocked={taskLocked}
                readUnavailable={readUnavailable}
              />
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && filteredCount > entriesPerPage && (
        <button type="button" className="mt-2 expense-list__show-more" onClick={onShowAll} disabled={busy}>
          {t("expenseList.showMore")}
        </button>
      )}
    </Card>
  );
}
