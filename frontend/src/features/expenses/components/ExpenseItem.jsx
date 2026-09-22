import { useEffect, useRef } from "react";
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
  const selectedCategory = editingData.category || "";
  const descriptionInputRef = useRef(null);
  const expenseLabel = `${displayText(expense.description)} from ${formatExpenseDate(expense.date)}, row ${rowNumber}`;
  const amountIsExact = Boolean(parseExpenseAmount(expense.amount));
  const editingAmountIsValid = Boolean(parseExpenseAmount(editingData.amount));

  useEffect(() => {
    if (isEditing) descriptionInputRef.current?.focus();
  }, [isEditing]);

  return (
    <tr className={`expense-row${isEditing ? " expense-row--editing" : ""}`}>
      <td className="expense-cell expense-cell--description" data-label="Description">
        {isEditing ? (
          <input
            ref={descriptionInputRef}
            disabled={busy}
            aria-label="Edit description"
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

      <td className="expense-cell expense-cell--amount" data-label="Amount ($)">
        {isEditing ? (
          <>
            <input
              disabled={busy}
              aria-label="Edit amount"
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
            {!editingAmountIsValid && <span className="status-message status-message--danger">Enter a valid exact amount.</span>}
          </>
        ) : (
          formatExactMoney(expense.amount).replace(/^\$/, "")
        )}
      </td>

      <td className="expense-cell expense-cell--date" data-label="Date">
        {isEditing ? (
          <input
            disabled={busy}
            aria-label="Edit date"
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

      <td className="expense-cell expense-cell--category" data-label="Category">
        {isEditing ? (
          <>
            <select
              disabled={busy}
            aria-label="Edit category"
              value={selectedCategory}
              onChange={(e) =>
                setEditingData((prev) => ({
                  ...prev,
                  category: e.target.value,
                }))
              }
            >
              <option value="">Category</option>
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c.toLowerCase()}>
                  {displayText(c)}
                </option>
              ))}
              <option value="other">Other</option>
            </select>

            {selectedCategory === "other" && (
              <input
                disabled={busy}
            aria-label="Edit custom category"
                type="text"
                placeholder="Custom Category"
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

      <td className="expense-cell expense-cell--actions" data-label="Actions">
        {isEditing ? (
          <div className="inline-actions">
            <button type="button" onClick={() => onSave(expense.id)} disabled={busy || readUnavailable || !editingAmountIsValid}>Save</button>
            <button type="button" className="button-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="inline-actions">
            <button
              type="button"
              aria-label={`Edit expense ${expenseLabel}`}
              onClick={(event) => onStartEdit(expense, event.currentTarget)}
              disabled={busy || taskLocked || readUnavailable || !amountIsExact}
            >
              Edit
            </button>
            <button
              type="button"
              className="button-danger"
              aria-label={`Delete expense ${expenseLabel}`}
              onClick={() => onDelete(expense.id)}
              disabled={busy || taskLocked || readUnavailable}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
