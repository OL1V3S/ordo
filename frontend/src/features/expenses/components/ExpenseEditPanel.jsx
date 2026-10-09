import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { parseExpenseAmount } from "../utils/exactMoney";

// The inline expense edit fields (moved verbatim from the former list row) in the task area.
export default function ExpenseEditPanel({
  expense, editingData, setEditingData, onSave, onCancel, busy = false, readUnavailable = false, descriptionRef,
}) {
  const { t } = useTranslation("activity");
  const localRef = useRef(null);
  const inputRef = descriptionRef ?? localRef;
  const selectedCategory = editingData.category || "";
  const editingAmountIsValid = Boolean(parseExpenseAmount(editingData.amount));
  const update = (field) => (e) => setEditingData((prev) => ({ ...prev, [field]: e.target.value }));

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <section className="card section expense-edit-panel" role="group" aria-labelledby="expense-edit-heading">
      <h2 id="expense-edit-heading" className="h2">{t("expenseEdit.title")}</h2>
      <div className="expense-edit-panel__fields">
        <label className="field">{t("expenseForm.description")}
          <input ref={inputRef} disabled={busy} aria-label={t("expenseItem.editDescription")}
            value={editingData.description || ""} onChange={update("description")} />
        </label>
        <label className="field">{t("expenseForm.amount")}
          <input disabled={busy} aria-label={t("expenseItem.editAmount")} aria-invalid={!editingAmountIsValid}
            type="text" inputMode="decimal" value={editingData.amount || ""} onChange={update("amount")} />
          {!editingAmountIsValid && <span className="status-message status-message--danger">{t("expenseItem.amountInvalid")}</span>}
        </label>
        <label className="field">{t("expenseForm.date")}
          <input disabled={busy} aria-label={t("expenseItem.editDate")} type="date"
            value={editingData.date || ""} onChange={update("date")} />
        </label>
        <div className="field">
          <label className="field">{t("expenseForm.category")}
            <select disabled={busy} aria-label={t("expenseItem.editCategory")} value={selectedCategory} onChange={update("category")}>
              <option value="">{t("expenseItem.categoryPlaceholder")}</option>
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c.toLowerCase()}>{t(`categories.${c.toLowerCase()}`)}</option>
              ))}
              <option value="other">{t("categories.other")}</option>
            </select>
          </label>
          {selectedCategory === "other" && (
            <input disabled={busy} aria-label={t("expenseItem.editCustomCategory")} type="text"
              placeholder={t("expenseItem.customCategoryPlaceholder")} value={editingData.customCategory || ""}
              onChange={update("customCategory")} />
          )}
        </div>
      </div>
      <div className="inline-actions">
        <button type="button" onClick={() => onSave(expense.id)} disabled={busy || readUnavailable || !editingAmountIsValid}>{t("expenseItem.save")}</button>
        <button type="button" className="button-ghost" onClick={onCancel} disabled={busy}>{t("expenseItem.cancel")}</button>
      </div>
    </section>
  );
}
