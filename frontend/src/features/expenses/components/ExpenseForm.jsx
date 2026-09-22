import { useRef, useState } from "react";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { displayText } from "../../../utils/text";
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
}) {
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
      <h2 className="h2">Add expense</h2>
      <form ref={formRef} noValidate onSubmit={handleSubmit}
        onChange={() => setInvalidField("")} aria-describedby={invalidField ? "add-expense-validation" : undefined}>
        {invalidField && <p id="add-expense-validation" className="status-message status-message--danger" role="alert">
          {invalidField === "amount"
            ? "Enter a positive amount with at most two decimals, up to 9999999999999999.99."
            : "Complete the required expense fields."}
        </p>}
        <fieldset className="activity-form-fields" disabled={pending}>
        <legend className="sr-only">New expense</legend>
        <div className="form-grid">
        <FormField label="Description">{(id) => <input id={id}
          ref={inputRef}
          name="description"
          required
          aria-invalid={invalidField === "description"}
          aria-describedby={invalidField === "description" ? "add-expense-validation" : undefined}
          placeholder="Description"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />}</FormField>

        <FormField label="Amount">{(id) => <input id={id}
          type="text"
          inputMode="decimal"
          name="amount"
          required
          aria-invalid={invalidField === "amount"}
          aria-describedby={invalidField === "amount" ? "add-expense-validation" : undefined}
          placeholder="Amount"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />}</FormField>

        <FormField label="Date">{(id) => <input id={id}
          type="date"
          name="date"
          required
          aria-invalid={invalidField === "date"}
          aria-describedby={invalidField === "date" ? "add-expense-validation" : undefined}
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />}</FormField>

        <FormField label="Category">{(id) => <select id={id} name="category" required
          aria-invalid={invalidField === "category"}
          aria-describedby={invalidField === "category" ? "add-expense-validation" : undefined}
          value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
          <option value="">Category</option>

          {DEFAULT_CATEGORIES.map((c) => (
            <option key={c} value={c.toLowerCase()}>
              {displayText(c)}
            </option>
          ))}

          <option value="other">Other</option>
        </select>}</FormField>

        {newCategory === "other" && (
          <FormField label="Custom category">{(id) => <input id={id}
            type="text"
            placeholder="Custom Category"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
          />}</FormField>
        )}

        </div>
        </fieldset>
        <div className="inline-actions activity-task-actions">
          <button type="submit" disabled={loading || pending}>
            {pending ? "Saving…" : "Save expense"}
          </button>
          <button type="button" className="button-ghost" onClick={handleCancel} disabled={pending}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
