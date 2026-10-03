import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import Card from "../../../shared/ui/Card";
import FormField from "../../../shared/ui/FormField";
import { parseExpenseAmount } from "../utils/exactMoney";

export default function ExpenseForm({
  loading,
  onAdd,
  newName,
  setNewName,
  newAmount,
  setNewAmount,
  newDate,
  setNewDate,
  newCategory,
  setNewCategory,
  customCategory,
  setCustomCategory,
  onCancel,
  inputRef,
  pending = false,
  copy = {},
}) {
  const { t } = useTranslation("activity");
  const formRef = useRef(null);
  const [invalidField, setInvalidField] = useState("");

  function firstInvalidField() {
    const missing = [
      ["description", newName],
      ["amount", newAmount],
      ["date", newDate],
      ["category", newCategory],
    ].find(([, value]) => !value)?.[0];
    if (missing) return missing;
    return parseExpenseAmount(newAmount) ? "" : "amount";
  }

  function handleSubmit(event) {
    event.preventDefault();
    const invalid = firstInvalidField();
    if (invalid) {
      setInvalidField(invalid);
      window.requestAnimationFrame(() => formRef.current?.elements.namedItem(invalid)?.focus());
      return;
    }
    setInvalidField("");
    onAdd();
  }

  function handleCancel() {
    setInvalidField("");
    onCancel();
  }

  return (
    <Card as="section" className="section">
      <h2 className="h2">{copy.title ?? t("expenseForm.title")}</h2>
      <form ref={formRef} noValidate onSubmit={handleSubmit}
        onChange={() => setInvalidField("")} aria-describedby={invalidField ? "add-expense-validation" : undefined}>
        {invalidField && <p id="add-expense-validation" className="status-message status-message--danger" role="alert">
          {invalidField === "amount"
            ? (copy.amountInvalid ?? t("expenseForm.amountInvalid"))
            : (copy.fieldsRequired ?? t("expenseForm.fieldsRequired"))}
        </p>}
        <fieldset className="activity-form-fields" disabled={pending}>
        <legend className="sr-only">{copy.newExpenseLegend ?? t("expenseForm.legend")}</legend>
        <div className="form-grid">
        <FormField label={copy.description ?? t("expenseForm.description")}>{(id) => <input id={id}
          ref={inputRef}
          name="description"
          required
          aria-invalid={invalidField === "description"}
          aria-describedby={invalidField === "description" ? "add-expense-validation" : undefined}
          placeholder={copy.descriptionPlaceholder ?? t("expenseForm.descriptionPlaceholder")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />}</FormField>

        <FormField label={copy.amount ?? t("expenseForm.amount")}>{(id) => <input id={id}
          type="text"
          inputMode="decimal"
          name="amount"
          required
          aria-invalid={invalidField === "amount"}
          aria-describedby={invalidField === "amount" ? "add-expense-validation" : undefined}
          placeholder={copy.amountPlaceholder ?? t("expenseForm.amountPlaceholder")}
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />}</FormField>

        <FormField label={copy.date ?? t("expenseForm.date")}>{(id) => <input id={id}
          type="date"
          name="date"
          required
          aria-invalid={invalidField === "date"}
          aria-describedby={invalidField === "date" ? "add-expense-validation" : undefined}
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />}</FormField>

        <FormField label={copy.category ?? t("expenseForm.category")}>{(id) => <select id={id} name="category" required
          aria-invalid={invalidField === "category"}
          aria-describedby={invalidField === "category" ? "add-expense-validation" : undefined}
          value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
          <option value="">{copy.categoryPlaceholder ?? t("expenseForm.categoryPlaceholder")}</option>

          {DEFAULT_CATEGORIES.map((c) => (
            <option key={c} value={c.toLowerCase()}>
              {copy.categories?.[c.toLowerCase()] ?? t(`categories.${c.toLowerCase()}`)}
            </option>
          ))}

          <option value="other">{copy.categories?.other ?? t("categories.other")}</option>
        </select>}</FormField>

        {newCategory === "other" && (
          <FormField label={copy.customCategory ?? t("expenseForm.customCategory")}>{(id) => <input id={id}
            type="text"
            placeholder={copy.customCategoryPlaceholder ?? t("expenseForm.customCategoryPlaceholder")}
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
          />}</FormField>
        )}

        </div>
        </fieldset>
        <div className="inline-actions activity-task-actions">
          <button type="submit" disabled={loading || pending}>
            {pending ? (copy.saving ?? t("expenseForm.saving")) : (copy.save ?? t("expenseForm.save"))}
          </button>
          <button type="button" className="button-ghost" onClick={handleCancel} disabled={pending}>{copy.cancel ?? t("expenseForm.cancel")}</button>
        </div>
      </form>
    </Card>
  );
}
