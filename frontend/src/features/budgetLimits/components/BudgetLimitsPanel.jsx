import { useMemo, useRef, useState } from "react";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { displayText, normalizeText } from "../../../utils/text";
import FormField from "../../../shared/ui/FormField";
import StatusMessage from "../../../shared/ui/StatusMessage";
import {
  formatCents,
  parseBudgetLimit,
  parseExactMoney,
  percentageFromRatio,
} from "../../expenses/utils/exactMoney";

const roundMoney = (value) => Number(parseFloat(value || 0).toFixed(2));
const isValidMoney = (value) => /^\d*\.?\d{0,2}$/.test(value);
function focusAfterRender(target) {
  window.requestAnimationFrame(() => target()?.focus());
}

export default function BudgetLimitsPanel({
  limitMonthYear, setLimitMonthYear, budgetLimits, limitsLoading,
  limitsError = null, refreshLimits = async () => {},
  spendingLoading = false, spendingError = null, refreshSpending = async () => {},
  totalsByCategory, upsertLimit, deleteLimit,
}) {
  // Preserve the existing exact category keys and last-record grouping.
  const budgetLimitsByCategory = useMemo(() => {
    const result = {};
    for (const limit of budgetLimits ?? []) result[limit.category] = limit;
    return result;
  }, [budgetLimits]);
  const [task, setTask] = useState(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [validation, setValidation] = useState(null);
  const [outcomeNeedsRefresh, setOutcomeNeedsRefresh] = useState(false);
  const writeInFlight = useRef(false);
  const taskOpener = useRef(null);
  const taskField = useRef(null);
  const amountField = useRef(null);
  const addButton = useRef(null);
  const feedbackRegion = useRef(null);
  const sectionHeading = useRef(null);
  const limitsUnavailable = !limitMonthYear || limitsLoading || Boolean(limitsError);
  const mutationDisabled = pending || limitsUnavailable || outcomeNeedsRefresh;
  const spendingAvailable = !spendingLoading && !spendingError;
  const [year, month] = limitMonthYear.split("-").map(Number);
  const nextResetDate = limitMonthYear ? new Date(year, month, 1).toLocaleDateString() : "";

  function openAdd() {
    if (task || mutationDisabled) return;
    taskOpener.current = addButton.current;
    setValidation(null);
    setTask({ type: "add", month: limitMonthYear, category: "", customCategory: "", amount: "" });
    focusAfterRender(() => taskField.current);
  }
  function openEdit(category, opener) {
    if (task || mutationDisabled) return;
    taskOpener.current = opener;
    setValidation(null);
    const parsedLimit = parseBudgetLimit(budgetLimitsByCategory[category]?.limitAmount);
    setTask({
      type: "edit", month: limitMonthYear, category,
      amount: parsedLimit?.value ?? "",
    });
    focusAfterRender(() => taskField.current);
  }
  function cancelTask() {
    if (writeInFlight.current) return;
    setTask(null);
    focusAfterRender(() => taskOpener.current?.isConnected && !taskOpener.current.disabled
      ? taskOpener.current : sectionHeading.current);
  }
  async function mutate(action, successMessage) {
    if (writeInFlight.current || mutationDisabled) return;
    writeInFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await action();
      setTask(null);
      setOutcomeNeedsRefresh(Boolean(result?.refreshFailed));
      setFeedback({
        tone: result?.refreshFailed ? "warning" : "success",
        message: result?.refreshFailed
          ? `${successMessage} Budget limits could not be refreshed. Refresh limits before making another change.`
          : successMessage,
      });
    } catch {
      setOutcomeNeedsRefresh(true);
      setFeedback({ tone: "danger", message: "We couldn’t confirm the change. Refresh limits and check the saved budgets before trying again." });
    } finally {
      writeInFlight.current = false;
      setPending(false);
      focusAfterRender(() => feedbackRegion.current);
    }
  }
  function saveTask() {
    if (!task || mutationDisabled) return;
    if (task.type === "add" && (!task.category || !task.amount || !task.month)) {
      const field = !task.category ? "category" : "amount";
      setValidation(field);
      (field === "category" ? taskField.current : amountField.current)?.focus();
      return;
    }
    const category = task.type === "edit" ? task.category
      : task.category === "other" ? normalizeText(task.customCategory || "uncategorized")
        : normalizeText(task.category);
    const payload = {
      category, limitAmount: roundMoney(task.amount),
      monthYear: new Date(task.month + "-01T00:00:00").toISOString(),
    };
    return mutate(() => upsertLimit(payload), "Budget limit saved.");
  }
  function removeLimit(limit, category) {
    if (task || mutationDisabled) return;
    if (!window.confirm(`Delete budget limit for category "${displayText(category)}"?`)) return;
    return mutate(() => deleteLimit(limit.id), "Budget limit deleted.");
  }
  async function retryLimits() {
    try {
      await refreshLimits({ rethrow: true });
      setOutcomeNeedsRefresh(false);
      setFeedback(outcomeNeedsRefresh
        ? { tone: "info", message: "Budget limits refreshed. Check the saved limits before retrying your change." }
        : null);
    } catch {
      // Keep unknown write outcomes gated until the selected month can be read.
    }
  }

  return (
    <section className="budget-workspace" aria-labelledby="category-budgets-heading">
      <div className="budget-toolbar">
        <FormField label="Budget month">{(id) => <input id={id} type="month" value={limitMonthYear}
          disabled={Boolean(task) || pending || outcomeNeedsRefresh}
          onChange={(event) => { setLimitMonthYear(event.target.value); setFeedback(null); }} />}</FormField>
        <button type="button" ref={addButton} aria-expanded={task?.type === "add"} aria-controls="budget-task"
          disabled={Boolean(task) || mutationDisabled} onClick={openAdd}>Add category budget</button>
      </div>
      {task && <p className="muted budget-task-note">Finish or cancel this {task.month} budget before changing months.</p>}
      <div ref={feedbackRegion} tabIndex={-1} className="budget-feedback">
        {feedback && <StatusMessage tone={feedback.tone}>{feedback.message}</StatusMessage>}
      </div>
      <div id="budget-task" hidden={!task}>
        {task && <form className="card budget-form" noValidate onSubmit={(event) => { event.preventDefault(); saveTask(); }}>
          <h2>{task.type === "edit" ? `Edit ${displayText(task.category)} budget` : "Add category budget"}</h2>
          <p className="muted">For {task.month}</p>
          {validation && <div id="budget-validation"><StatusMessage tone="danger">Choose a category and enter a limit amount.</StatusMessage></div>}
          <fieldset disabled={pending}>
            <legend className="sr-only">Budget details</legend>
            <div className="budget-form__fields">
              {task.type === "add" && <FormField label="Category">{(id) => <select id={id} ref={taskField}
                aria-invalid={validation === "category" && !task.category} aria-describedby={validation ? "budget-validation" : undefined}
                value={task.category} onChange={(event) => setTask((current) => ({ ...current, category: event.target.value }))}>
                <option value="">Category</option>
                {DEFAULT_CATEGORIES.map((category) => <option key={category} value={category.toLowerCase()}>{displayText(category)}</option>)}
                <option value="other">Other</option>
              </select>}</FormField>}
              {task.type === "add" && task.category === "other" && <FormField label="Custom category">{(id) => <input id={id}
                placeholder="Custom Category" value={task.customCategory}
                onChange={(event) => setTask((current) => ({ ...current, customCategory: event.target.value }))} />}</FormField>}
              <FormField label={task.type === "edit" ? `Limit amount for ${displayText(task.category)}` : "Limit amount"}>{(id) => <input id={id}
                ref={(element) => { amountField.current = element; if (task.type === "edit") taskField.current = element; }}
                aria-invalid={validation === "amount" && !task.amount} aria-describedby={validation ? "budget-validation" : undefined}
                type="text" inputMode="decimal" placeholder="Limit Amount" value={task.amount}
                onChange={(event) => {
                  if (isValidMoney(event.target.value)) setTask((current) => ({ ...current, amount: event.target.value }));
                }} />}</FormField>
            </div>
          </fieldset>
          <div className="inline-actions">
            <button type="submit" disabled={mutationDisabled}>{pending ? "Saving…" : "Save limit"}</button>
            <button type="button" className="button-ghost" disabled={pending} onClick={cancelTask}>Cancel</button>
          </div>
        </form>}
      </div>
      <div className="budget-section-header">
        <h2 id="category-budgets-heading" ref={sectionHeading} tabIndex={-1}>Category budgets</h2>
        <button type="button" className="button-ghost" disabled={limitsLoading || pending || !limitMonthYear} onClick={retryLimits}>Refresh limits</button>
      </div>
      {!limitMonthYear ? <StatusMessage>Choose a month to view its category budgets.</StatusMessage>
        : limitsLoading ? <StatusMessage>Loading budget limits...</StatusMessage>
          : limitsError ? <StatusMessage tone="danger">We couldn’t load budget limits for {limitMonthYear}. Refresh limits to try again.</StatusMessage>
            : null}
      {limitMonthYear && spendingLoading && <StatusMessage>Loading recorded spending...</StatusMessage>}
      {limitMonthYear && spendingError && <div className="budget-spending-error">
        <StatusMessage tone="danger">We couldn’t load recorded spending. Used amounts and progress are unavailable.</StatusMessage>
        <button type="button" className="button-ghost" disabled={spendingLoading || pending}
          onClick={() => refreshSpending().catch(() => {})}>Retry spending</button>
      </div>}
      {!limitsUnavailable && (Object.keys(budgetLimitsByCategory).length === 0
        ? <p className="empty-state">No budget limits set for this month.</p>
        : <div className="budget-cards">
          {Object.entries(budgetLimitsByCategory).map(([category, limit]) => {
            const name = displayText(category);
            const totalValue = totalsByCategory[category] === undefined ? "0.00" : totalsByCategory[category];
            const used = parseExactMoney(totalValue, { allowZero: true });
            const limitAmount = parseBudgetLimit(limit.limitAmount);
            const comparisonAvailable = spendingAvailable && Boolean(used && limitAmount);
            const percentage = comparisonAvailable && limitAmount.cents > 0n
              ? percentageFromRatio(used.cents, limitAmount.cents) : null;
            const warning = comparisonAvailable && (limitAmount.cents === 0n
              || used.cents * 100n >= limitAmount.cents * 90n);
            const status = !spendingAvailable ? "Spending unavailable"
              : !used ? "Spending needs review"
                : !limitAmount ? "Limit needs review"
                  : limitAmount.cents === 0n ? "Zero limit"
                : used.cents > limitAmount.cents ? "Over limit" : used.cents === limitAmount.cents ? "Limit reached"
                  : warning ? "Near limit" : "Within limit";
            return <article key={category} className={`card budget-card${warning ? " budget-card--warning" : ""}`} aria-label={`${name} budget`}>
              <div className="budget-card__header"><h3>{name}</h3><span className="budget-card__status">{status}</span></div>
              <p className="budget-card__amounts">
                <strong>{spendingAvailable && used ? formatCents(used.cents) : "Unavailable"}</strong>
                <span> used of {limitAmount ? formatCents(limitAmount.cents) : "Unavailable"}</span>
              </p>
              {comparisonAvailable && limitAmount.cents > 0n && <div className="budget-card__progress">
                <progress max="100" value={Math.min(100, Math.max(0, percentage))} aria-label={`${name} budget used`}
                  aria-valuetext={`${formatCents(used.cents)} used of ${formatCents(limitAmount.cents)}, ${Math.round(percentage)}%`} />
                <span>{Math.round(percentage)}% used</span>
              </div>}
              {comparisonAvailable && limitAmount.cents === 0n && <p className="muted budget-card__note">No percentage for a zero limit.</p>}
              {spendingAvailable && (!used || !limitAmount) && <p className="muted budget-card__note">Exact comparison is unavailable. Review the amount before relying on this budget status.</p>}
              <div className="inline-actions">
                <button type="button" aria-label={`Edit ${name} budget`} aria-controls="budget-task"
                  aria-expanded={task?.type === "edit" && task.category === category}
                  disabled={Boolean(task) || mutationDisabled} onClick={(event) => openEdit(category, event.currentTarget)}>Edit</button>
                <button type="button" className="button-danger" aria-label={`Delete ${name} budget`}
                  disabled={Boolean(task) || mutationDisabled} onClick={() => removeLimit(limit, category)}>Delete</button>
              </div>
            </article>;
          })}
        </div>)}
      {limitMonthYear && <details className="budget-explanation">
        <summary>About monthly limits</summary>
        <p>Next reset: {nextResetDate}. Each limit applies to its selected calendar month.</p>
        <p>A zero limit is an intentional no-spend budget. It is different from having no budget for a category.</p>
      </details>}
    </section>
  );
}
