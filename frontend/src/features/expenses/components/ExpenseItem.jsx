import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { displayText } from "../../../utils/text";
import { formatExpenseDate } from "../utils/calendarDate";
import { formatExactMoney, parseExpenseAmount } from "../utils/exactMoney";

export default function ExpenseItem({
  expense,
  rowNumber,
  isEditing,
  editingData,
  setEditingData,
  onStartEdit,
  onSave,
  onCancel,
  onDelete,
  busy = false,
  taskLocked = false,
  readUnavailable = false,
}) {
  const { t } = useTranslation("activity");
  const selectedCategory = editingData.category || "";
  const descriptionInputRef = useRef(null);
  const labelValues = { description: displayText(expense.description), date: formatExpenseDate(expense.date), row: rowNumber };
  const amountIsExact = Boolean(parseExpenseAmount(expense.amount));
  const editingAmountIsValid = Boolean(parseExpenseAmount(editingData.amount));

  useEffect(() => {
    if (isEditing) descriptionInputRef.current?.focus();
  }, [isEditing]);

  return (
    <tr className={`expense-row${isEditing ? " expense-row--editing" : ""}`}>
      <td className="expense-cell expense-cell--description" data-label={t("expenseList.columns.description")}>
        {isEditing ? (
          <input
            ref={descriptionInputRef}
            disabled={busy}
            aria-label={t("expenseItem.editDescription")}
            value={editingData.description || ""}
            onChange={(e) =>
              setEditingData((prev) => ({
                ...prev,
                description: e.target.value,
              }))
            }
          />
        ) : (
          displayText(expense.description)
        )}
      </td>

      <td className="expense-cell expense-cell--amount" data-label={t("expenseList.columns.amount")}>
        {isEditing ? (
          <>
            <input
              disabled={busy}
              aria-label={t("expenseItem.editAmount")}
              aria-invalid={!editingAmountIsValid}
              type="text"
              inputMode="decimal"
              value={editingData.amount || ""}
              onChange={(e) =>
                setEditingData((prev) => ({
                  ...prev,
                  amount: e.target.value,
                }))
              }
            />
            {!editingAmountIsValid && <span className="status-message status-message--danger">{t("expenseItem.amountInvalid")}</span>}
          </>
        ) : (
          amountIsExact ? formatExactMoney(expense.amount).replace(/^\$/, "") : t("expenseItem.amountReview")
        )}
      </td>

      <td className="expense-cell expense-cell--date" data-label={t("expenseList.columns.date")}>
        {isEditing ? (
          <input
            disabled={busy}
            aria-label={t("expenseItem.editDate")}
            type="date"
            value={editingData.date || ""}
            onChange={(e) =>
              setEditingData((prev) => ({
                ...prev,
                date: e.target.value,
              }))
            }
          />
        ) : (
          formatExpenseDate(expense.date)
        )}
      </td>

      <td className="expense-cell expense-cell--category" data-label={t("expenseList.columns.category")}>
        {isEditing ? (
          <>
            <select
              disabled={busy}
            aria-label={t("expenseItem.editCategory")}
              value={selectedCategory}
              onChange={(e) =>
                setEditingData((prev) => ({
                  ...prev,
                  category: e.target.value,
                }))
              }
            >
              <option value="">{t("expenseItem.categoryPlaceholder")}</option>
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c.toLowerCase()}>
                  {t(`categories.${c.toLowerCase()}`)}
                </option>
              ))}
              <option value="other">{t("categories.other")}</option>
            </select>

            {selectedCategory === "other" && (
              <input
                disabled={busy}
            aria-label={t("expenseItem.editCustomCategory")}
                type="text"
                placeholder={t("expenseItem.customCategoryPlaceholder")}
                value={editingData.customCategory || ""}
                onChange={(e) =>
                  setEditingData((prev) => ({
                    ...prev,
                    customCategory: e.target.value,
                  }))
                }
              />
            )}
          </>
        ) : (
          displayText(expense.category)
        )}
      </td>

      <td className="expense-cell expense-cell--actions" data-label={t("expenseList.columns.actions")}>
        {isEditing ? (
          <div className="inline-actions">
            <button type="button" onClick={() => onSave(expense.id)} disabled={busy || readUnavailable || !editingAmountIsValid}>{t("expenseItem.save")}</button>
            <button type="button" className="button-ghost" onClick={onCancel} disabled={busy}>
              {t("expenseItem.cancel")}
            </button>
          </div>
        ) : (
          <div className="inline-actions">
            <button
              type="button"
              aria-label={t("expenseItem.editLabel", labelValues)}
              onClick={(event) => onStartEdit(expense, event.currentTarget)}
              disabled={busy || taskLocked || readUnavailable || !amountIsExact}
            >
              {t("expenseItem.edit")}
            </button>
            <button
              type="button"
              className="button-danger"
              aria-label={t("expenseItem.deleteLabel", labelValues)}
              onClick={() => onDelete(expense.id)}
              disabled={busy || taskLocked || readUnavailable}
            >
              {t("expenseItem.delete")}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
