import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("budgets");
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
  async function mutate(action, successKey) {
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
        key: result?.refreshFailed ? `${successKey}RefreshFailed` : successKey,
      });
    } catch {
      setOutcomeNeedsRefresh(true);
      setFeedback({ tone: "danger", key: "unconfirmed" });
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
    return mutate(() => upsertLimit(payload), "saved");
  }
  function removeLimit(limit, category) {
    if (task || mutationDisabled) return;
    if (!window.confirm(t("confirmDelete", { category: displayText(category) }))) return;
    return mutate(() => deleteLimit(limit.id), "deleted");
  }
  async function retryLimits() {
    try {
      await refreshLimits({ rethrow: true });
      setOutcomeNeedsRefresh(false);
      setFeedback(outcomeNeedsRefresh
        ? { tone: "info", key: "refreshed" }
        : null);
    } catch {
      // Keep unknown write outcomes gated until the selected month can be read.
    }
  }

  return (
    <section className="budget-workspace" aria-labelledby="category-budgets-heading">
      <div className="budget-toolbar">
        <FormField label={t("toolbar.month")}>{(id) => <input id={id} type="month" value={limitMonthYear}
          disabled={Boolean(task) || pending || outcomeNeedsRefresh}
          onChange={(event) => { setLimitMonthYear(event.target.value); setFeedback(null); }} />}</FormField>
        <button type="button" ref={addButton} aria-expanded={task?.type === "add"} aria-controls="budget-task"
          disabled={Boolean(task) || mutationDisabled} onClick={openAdd}>{t("toolbar.add")}</button>
      </div>
      {task && <p className="muted budget-task-note">{t("taskNote", { month: task.month })}</p>}
      <div ref={feedbackRegion} tabIndex={-1} className="budget-feedback">
        {feedback && <StatusMessage tone={feedback.tone}>{t(`feedback.${feedback.key}`)}</StatusMessage>}
      </div>
      <div id="budget-task" hidden={!task}>
        {task && <form className="card budget-form" noValidate onSubmit={(event) => { event.preventDefault(); saveTask(); }}>
          <h2>{task.type === "edit" ? t("form.editHeading", { category: displayText(task.category) }) : t("form.addHeading")}</h2>
          <p className="muted">{t("form.forMonth", { month: task.month })}</p>
          {validation && <div id="budget-validation"><StatusMessage tone="danger">{t("form.validation")}</StatusMessage></div>}
          <fieldset disabled={pending}>
            <legend className="sr-only">{t("form.details")}</legend>
            <div className="budget-form__fields">
              {task.type === "add" && <FormField label={t("form.category")}>{(id) => <select id={id} ref={taskField}
                aria-invalid={validation === "category" && !task.category} aria-describedby={validation ? "budget-validation" : undefined}
                value={task.category} onChange={(event) => setTask((current) => ({ ...current, category: event.target.value }))}>
                <option value="">{t("form.categoryPlaceholder")}</option>
                {DEFAULT_CATEGORIES.map((category) => <option key={category} value={category.toLowerCase()}>{t(`categories.${category.toLowerCase()}`)}</option>)}
                <option value="other">{t("categories.other")}</option>
              </select>}</FormField>}
              {task.type === "add" && task.category === "other" && <FormField label={t("form.customCategory")}>{(id) => <input id={id}
                placeholder={t("form.customCategoryPlaceholder")} value={task.customCategory}
                onChange={(event) => setTask((current) => ({ ...current, customCategory: event.target.value }))} />}</FormField>}
              <FormField label={task.type === "edit" ? t("form.editLimitAmount", { category: displayText(task.category) }) : t("form.limitAmount")}>{(id) => <input id={id}
                ref={(element) => { amountField.current = element; if (task.type === "edit") taskField.current = element; }}
                aria-invalid={validation === "amount" && !task.amount} aria-describedby={validation ? "budget-validation" : undefined}
                type="text" inputMode="decimal" placeholder={t("form.limitAmountPlaceholder")} value={task.amount}
                onChange={(event) => {
                  if (isValidMoney(event.target.value)) setTask((current) => ({ ...current, amount: event.target.value }));
                }} />}</FormField>
            </div>
          </fieldset>
          <div className="inline-actions">
            <button type="submit" disabled={mutationDisabled}>{pending ? t("form.saving") : t("form.save")}</button>
            <button type="button" className="button-ghost" disabled={pending} onClick={cancelTask}>{t("form.cancel")}</button>
          </div>
        </form>}
      </div>
      <div className="budget-section-header">
        <h2 id="category-budgets-heading" ref={sectionHeading} tabIndex={-1}>{t("section.heading")}</h2>
        <button type="button" className="button-ghost" disabled={limitsLoading || pending || !limitMonthYear} onClick={retryLimits}>{t("section.refresh")}</button>
      </div>
      {!limitMonthYear ? <StatusMessage>{t("states.chooseMonth")}</StatusMessage>
        : limitsLoading ? <StatusMessage>{t("states.loadingLimits")}</StatusMessage>
          : limitsError ? <StatusMessage tone="danger">{t("states.limitsError", { month: limitMonthYear })}</StatusMessage>
            : null}
      {limitMonthYear && spendingLoading && <StatusMessage>{t("states.loadingSpending")}</StatusMessage>}
      {limitMonthYear && spendingError && <div className="budget-spending-error">
        <StatusMessage tone="danger">{t("states.spendingError")}</StatusMessage>
        <button type="button" className="button-ghost" disabled={spendingLoading || pending}
          onClick={() => refreshSpending().catch(() => {})}>{t("states.retrySpending")}</button>
      </div>}
      {!limitsUnavailable && (Object.keys(budgetLimitsByCategory).length === 0
        ? <p className="empty-state">{t("states.empty")}</p>
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
            const status = !spendingAvailable ? "spendingUnavailable"
              : !used ? "spendingNeedsReview"
                : !limitAmount ? "limitNeedsReview"
                  : limitAmount.cents === 0n ? "zeroLimit"
                : used.cents > limitAmount.cents ? "overLimit" : used.cents === limitAmount.cents ? "limitReached"
                  : warning ? "nearLimit" : "withinLimit";
            return <article key={category} className={`card budget-card${warning ? " budget-card--warning" : ""}`} aria-label={t("card.ariaLabel", { name })}>
              <div className="budget-card__header"><h3>{name}</h3><span className="budget-card__status">{t(`card.status.${status}`)}</span></div>
              <p className="budget-card__amounts">
                <strong>{spendingAvailable && used ? formatCents(used.cents) : t("card.unavailable")}</strong>
                <span> {t("card.usedOf", { limit: limitAmount ? formatCents(limitAmount.cents) : t("card.unavailable") })}</span>
              </p>
              {comparisonAvailable && limitAmount.cents > 0n && <div className="budget-card__progress">
                <progress max="100" value={Math.min(100, Math.max(0, percentage))} aria-label={t("card.progressLabel", { name })}
                  aria-valuetext={t("card.progressValue", { used: formatCents(used.cents), limit: formatCents(limitAmount.cents), percent: Math.round(percentage) })} />
                <span>{t("card.percentUsed", { percent: Math.round(percentage) })}</span>
              </div>}
              {comparisonAvailable && limitAmount.cents === 0n && <p className="muted budget-card__note">{t("card.zeroLimitNote")}</p>}
              {spendingAvailable && (!used || !limitAmount) && <p className="muted budget-card__note">{t("card.comparisonUnavailable")}</p>}
              <div className="inline-actions">
                <button type="button" aria-label={t("card.editLabel", { name })} aria-controls="budget-task"
                  aria-expanded={task?.type === "edit" && task.category === category}
                  disabled={Boolean(task) || mutationDisabled} onClick={(event) => openEdit(category, event.currentTarget)}>{t("card.edit")}</button>
                <button type="button" className="button-danger" aria-label={t("card.deleteLabel", { name })}
                  disabled={Boolean(task) || mutationDisabled} onClick={() => removeLimit(limit, category)}>{t("card.delete")}</button>
              </div>
            </article>;
          })}
        </div>)}
      {limitMonthYear && <details className="budget-explanation">
        <summary>{t("explanation.summary")}</summary>
        <p>{t("explanation.reset", { date: nextResetDate })}</p>
        <p>{t("explanation.zeroLimit")}</p>
      </details>}
    </section>
  );
}
