import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../shared/localization/useLocale";
import { expensesApi } from "../../features/expenses/api/expensesApi";
import { inflowsApi } from "../../features/inflows/api/inflowsApi";
import { useExpenseCapture } from "../../features/expenses/hooks/useExpenseCapture";
import { useInflowCapture } from "../../features/inflows/hooks/useInflowCapture";
import ExpenseForm from "../../features/expenses/components/ExpenseForm";
import InflowForm from "../../features/inflows/components/InflowForm";
import StatusMessage from "../../shared/ui/StatusMessage";
import SectionHeader from "../../shared/ui/SectionHeader";
import ListRow from "../../shared/ui/ListRow";
import { DisclosureButton } from "../../shared/ui/Disclosure";
import { useForcedOpen } from "../../shared/ui/useForcedOpen";
import { getSessionSnapshot } from "../../shared/auth/session";
import { useHomeData } from "../../features/home/hooks/useHomeData";
import { useCaptureRecovery } from "../../features/home/recovery/captureRecovery";
import {
  formatHomeAmount,
  formatHomeDate,
  formatHomeProjectionAmount,
  isHomeAttentionSection,
  isHomeUpcomingSection,
} from "../../features/home/utils/homePresentation";
import "../../styles/home-capture.css";

export default function OverviewPage() {
  const { t } = useTranslation("home");
  const { locale } = useLocale();
  const data = useHomeData();
  const recovery = useCaptureRecovery();
  const [active, setActive] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const expenseButton = useRef(null);
  const cashInButton = useRef(null);
  const recoveryLink = useRef(null);
  const addMenu = useForcedOpen(Boolean(active));
  const moneyLocale = locale === "es" ? "es-US" : "en-US";
  const refreshAfterWrite = async () => {
    const session = getSessionSnapshot();
    const result = await data.refresh();
    if (session !== getSessionSnapshot()) return { stale: true };
    return { refreshFailed: result.stale || result.failed };
  };
  const expense = useExpenseCapture({
    createExpense: async (payload) => {
      await expensesApi.create(payload);
      return refreshAfterWrite();
    },
    refresh: data.refresh,
    readUnavailable: false,
    isExternallyBlocked: () => active === "cashIn" || Boolean(recovery.source),
    onUnknown: () => recovery.mark("expense"),
  });
  const cashIn = useInflowCapture({
    records: [], loading: false, error: null,
    createInflow: async (payload) => {
      await inflowsApi.create(payload);
      return refreshAfterWrite();
    },
    refresh: data.refresh,
    isExternallyBlocked: () => active === "expense" || Boolean(recovery.source),
    onUnknown: () => recovery.mark("account_inflow"),
  });
  const startExpense = () => { if (canStart) { setFeedback(null); setActive("expense"); expense.openCreate(expenseButton.current); } };
  const startCashIn = () => { if (canStart) { setFeedback(null); setActive("cashIn"); cashIn.openTask("create", null, cashInButton.current); } };
  const closeExpense = () => { expense.closeCreate(); setActive(null); };
  const closeCashIn = () => { cashIn.cancelTask(); setActive(null); };
  const onExpenseSubmit = async () => {
    await expense.submitCreate();
  };
  const onCashSubmit = async () => {
    await cashIn.submitTask();
  };
  useEffect(() => {
    const next = expense.feedback ? { ...expense.feedback, source: "expense" }
      : cashIn.feedback ? { ...cashIn.feedback, source: "cashIn" } : null;
    if (!next) return;
    setFeedback(next);
    if (next.outcome === "completed" || next.outcome === "unknown") setActive(null);
  }, [expense.feedback, cashIn.feedback]);
  useEffect(() => {
    if (!recovery.source) return undefined;
    const frame = window.requestAnimationFrame(() => recoveryLink.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [recovery.source]);
  const canStart = !active && !recovery.source && !recovery.loading && !expense.recoveryRequired && !cashIn.gate;
  async function refreshHome() {
    let refreshed = false;
    if (expense.recoveryRequired) { await expense.refreshRecovery(); refreshed = true; }
    if (cashIn.gate && cashIn.gate !== "unknown") { await cashIn.refreshRecovery(); refreshed = true; }
    if (!refreshed) await data.refresh();
  }
  const rows = data.data?.recentActivity?.availability?.state === "available"
    ? data.data.recentActivity.items.slice(0, 3) : [];
  const upcoming = data.data?.upcoming;
  const upcomingValid = data.data
    && isHomeUpcomingSection(upcoming, data.data.evaluations.upcomingEvaluatedOn);
  const upcomingState = data.loading ? "loading"
    : data.error || !data.data ? "homeUnavailable"
      : !upcomingValid ? "malformed"
        : upcoming.availability.state === "unavailable" ? "unavailable"
          : upcoming.items.length === 0 ? "empty" : "available";
  const attention = data.data?.attention;
  const attentionValid = data.data
    && isHomeAttentionSection(attention, data.data.evaluations.upcomingEvaluatedOn);
  const commitmentAvailable = attentionValid
    && attention.familyAvailability.commitment_change_review.state === "available";
  const budgetAvailable = attentionValid
    && attention.familyAvailability.budget_attention.state === "available";
  const commitmentItems = commitmentAvailable ? attention.items : [];
  const budgetItems = budgetAvailable ? attention.budgetItems : [];
  const orderedAttentionItems = [
    ...budgetItems.filter((item) => item.state !== "at_limit").map((item) => ({ type: "budget", item })),
    ...commitmentItems.map((item) => ({ type: "commitment", item })),
    ...budgetItems.filter((item) => item.state === "at_limit").map((item) => ({ type: "budget", item })),
  ];
  const attentionState = data.loading ? "loading"
    : data.error || !data.data ? "homeUnavailable"
      : !attentionValid ? "malformed"
        : attention.availability.state === "unavailable" ? "unavailable"
          : !commitmentAvailable || !budgetAvailable ? "partial"
            : orderedAttentionItems.length === 0 ? "empty" : "available";
  const visibleAttention = ["available", "partial"].includes(attentionState)
    ? orderedAttentionItems.slice(0, 2) : [];
  const visibleCommitmentCount = visibleAttention.filter((entry) => entry.type === "commitment").length;
  const reviewCount = commitmentItems.reduce((total, item) => total + item.reviews.length, 0);

  return <div className="shell-page home-capture-page">
    <header className="page-header"><div><h1>{t("page.title")}</h1></div></header>
    <section className="home-capture" aria-label={t("capture.heading")}>
      <div className="home-capture__add">
        <DisclosureButton controls="home-add-options" open={addMenu.open} forced={Boolean(active)} hint={t("capture.lock")}
          onToggle={addMenu.toggle} className="home-capture__add-toggle">{t("capture.add")}</DisclosureButton>
      </div>
      <div id="home-add-options" className="home-capture__actions" data-collapsed={addMenu.open ? undefined : "true"}>
        <button type="button" ref={expenseButton} disabled={!canStart} aria-expanded={active === "expense"} onClick={startExpense}>{t("capture.addExpense")}</button>
        <button type="button" ref={cashInButton} className="button-ghost" disabled={!canStart} aria-expanded={active === "cashIn"} onClick={startCashIn}>{t("capture.addCashIn")}</button>
      </div>
      {active && <p className="muted">{t("capture.lock")}</p>}
      <div hidden={active !== "expense"}>
        <ExpenseForm loading={Boolean(recovery.source)} pending={expense.pending} onAdd={onExpenseSubmit}
          onCancel={closeExpense} inputRef={expense.inputRef} newName={expense.draft.description}
          setNewName={(value) => expense.updateDraft("description", value)} newAmount={expense.draft.amount}
          setNewAmount={(value) => expense.updateDraft("amount", value)} newDate={expense.draft.date}
          setNewDate={(value) => expense.updateDraft("date", value)} newCategory={expense.draft.category}
          setNewCategory={(value) => expense.updateDraft("category", value)} customCategory={expense.draft.customCategory}
          setCustomCategory={(value) => expense.updateDraft("customCategory", value)}
          copy={{ ...t("capture.expense", { returnObjects: true }) }} />
      </div>
      <div hidden={active !== "cashIn"}>
        {cashIn.task && <InflowForm draft={cashIn.task.draft} onChange={cashIn.updateDraft} onSubmit={onCashSubmit}
          onCancel={closeCashIn} pending={cashIn.pending} disabled={Boolean(recovery.source)} fieldErrors={Object.fromEntries(Object.entries(cashIn.fieldErrors).map(([field, code]) => [field, t(`capture.cashIn.${code}`)]))}
          copy={{ ...t("capture.cashIn", { returnObjects: true }) }} />}
      </div>
      {feedback && <div ref={feedback.source === "expense" ? expense.feedbackRef : cashIn.feedbackRef} tabIndex={-1} role="status" aria-live="polite"><StatusMessage tone={feedback.tone}>{feedback.refreshFailed
        ? t(feedback.source === "expense" ? "capture.feedback.expenseSavedRefreshFailed" : "capture.feedback.cashInSavedRefreshFailed")
          : t(feedback.outcome === "unknown" ? "capture.feedback.unknown" : feedback.outcome === "refreshed" ? "capture.feedback.refreshed"
          : feedback.source === "expense" ? "capture.feedback.expenseSaved" : "capture.feedback.cashInSaved")}</StatusMessage></div>}
      {recovery.source && <div className="home-recovery" role="alert" aria-labelledby="home-recovery-heading">
        <h2 id="home-recovery-heading">{t("recovery.heading")}</h2>
        <p>{t(recovery.source === "expense" ? "recovery.bodyExpense" : "recovery.bodyCashIn")}</p>
        {recovery.volatile && <p>{t("recovery.storageVolatile")}</p>}
        <Link ref={recoveryLink} className="button-link" to="/transactions">{t("recovery.openActivity")}</Link>
      </div>}
      {data.error && <StatusMessage tone="danger">{t("capture.feedback.refreshFailed")}</StatusMessage>}
      {data.loading && <StatusMessage>{t("activity.loading")}</StatusMessage>}
    </section>
    <section className="home-attention" aria-labelledby="home-attention-heading" aria-busy={attentionState === "loading"}>
      <SectionHeader id="home-attention-heading" title={t("attention.heading")}
        action={["available", "partial"].includes(attentionState) && commitmentItems.length > 0
          ? <Link to="/commitments#changes-review-heading">{commitmentItems.length > visibleCommitmentCount
            ? t("attention.viewAll", { count: reviewCount }) : t("attention.openReviews")}</Link> : null} />
      {["available", "partial"].includes(attentionState) && visibleAttention.length > 0
        && <ul className="home-attention__list" aria-label={t("attention.listLabel")}>
        {visibleAttention.map(({ type, item }) => {
          if (type === "budget") {
            const spent = formatHomeProjectionAmount(item.spentAmount, moneyLocale);
            const limit = formatHomeProjectionAmount(item.limitAmount, moneyLocale);
            return <ListRow key={`budget-${item.category}`} title={item.category}
              meta={t(`attention.budgetStates.${item.state}`, { category: item.category, spent, limit })}
              actions={<Link to="/budgets" aria-label={t("attention.openBudgetForCategory", { category: item.category })}>
                {t("attention.openBudgets")}
              </Link>} />;
          }
          const reasons = item.reviews.map(({ dimension }) => t(`attention.dimensions.${dimension}`));
          return <ListRow key={item.commitmentId} title={item.commitmentName}
            meta={reasons.join(t("attention.reasonSeparator"))} />;
        })}
      </ul>}
      {attentionState === "empty"
        && <StatusMessage>{t("attention.empty")}</StatusMessage>}
      {attentionState === "partial"
        && <StatusMessage tone="warning">{t("attention.partialUnavailable")}</StatusMessage>}
      {!["available", "partial", "empty"].includes(attentionState) && <StatusMessage tone={attentionState === "unavailable" || attentionState === "malformed" ? "warning" : undefined}>
        {t(`attention.${attentionState}`)}
      </StatusMessage>}
      {!["available", "partial", "empty", "loading"].includes(attentionState)
        && <Link to="/commitments#changes-review-heading">{t("attention.openReviews")}</Link>}
    </section>
    <section className="home-recent" aria-labelledby="home-recent-heading" aria-busy={data.loading}>
      <SectionHeader id="home-recent-heading" title={t("activity.heading")}
        action={<Link to="/transactions">{t("activity.viewAll")}</Link>} />
      {data.error && <div><StatusMessage tone="danger">{t("activity.requestUnavailable")}</StatusMessage>
        <button type="button" className="button-ghost" onClick={refreshHome}>{t("activity.retry")}</button></div>}
      {!data.loading && !data.error && data.data?.recentActivity.availability.state === "unavailable"
        && <StatusMessage tone="warning">{t("activity.unavailable")}</StatusMessage>}
      {!data.loading && !data.error && data.data?.recentActivity.availability.state === "available" && (rows.length ?
        <ul className="home-recent__list">{rows.map((row) => <ListRow key={`${row.kind}-${row.recordId}`}
          label={t(row.kind === "expense" ? "activity.expense" : "activity.cashIn")} title={row.description}
          meta={<>{formatHomeDate(row.date, moneyLocale)}{row.category ? ` · ${row.category}` : ""}
            {row.paycheck && <> · {t("activity.paycheckLinked")}</>}</>}
          amount={<strong>{formatHomeAmount(row.amount, row.kind, moneyLocale) ?? t("activity.amountReview")}</strong>} />)}</ul> : <StatusMessage>{t("activity.empty")}</StatusMessage>)}
    </section>
    <section className="home-coming-up" aria-labelledby="home-coming-up-heading" aria-busy={upcomingState === "loading"}>
      <SectionHeader id="home-coming-up-heading" title={t("comingUp.heading")}
        action={<Link to="/paychecks">{t("comingUp.viewPaychecks")}</Link>} />
      <p className="home-coming-up__qualifier">{t("comingUp.qualifier")}</p>
      {upcomingState === "available" && <ul className="home-coming-up__list" aria-label={t("comingUp.listLabel")}>
        {upcoming.items.map((item) => {
          const windowLabel = item.earliestExpectedDate === item.latestExpectedDate
            ? t("comingUp.expectedDate", { date: formatHomeDate(item.earliestExpectedDate, moneyLocale) })
            : t("comingUp.expectedWindow", {
              start: formatHomeDate(item.earliestExpectedDate, moneyLocale),
              end: formatHomeDate(item.latestExpectedDate, moneyLocale),
            });
          const amountLabel = item.amount.mode === "fixed"
            ? t("comingUp.fixedAmount", { amount: formatHomeProjectionAmount(item.amount.fixedAmount, moneyLocale) })
            : t("comingUp.rangeAmount", {
              minimum: formatHomeProjectionAmount(item.amount.minimumAmount, moneyLocale),
              maximum: formatHomeProjectionAmount(item.amount.maximumAmount, moneyLocale),
            });
          const cadence = t(`comingUp.cadences.${item.cadence}`);
          const amountValue = item.amount.mode === "fixed"
            ? formatHomeProjectionAmount(item.amount.fixedAmount, moneyLocale)
            : t("comingUp.rangeValue", {
              minimum: formatHomeProjectionAmount(item.amount.minimumAmount, moneyLocale),
              maximum: formatHomeProjectionAmount(item.amount.maximumAmount, moneyLocale),
            });
          return <ListRow key={item.paycheckProfileId} className="home-coming-up__row" title={item.displayName}
            aria-label={t("comingUp.itemLabel", { name: item.displayName, amount: amountLabel, cadence: t("comingUp.cadence", { cadence }), window: windowLabel })}
            meta={<><span>{cadence}</span>{" · "}<span>{windowLabel}</span></>} amount={amountValue} />;
        })}
      </ul>}
      {upcomingState !== "available" && <StatusMessage tone={upcomingState === "malformed" || upcomingState === "unavailable" ? "warning" : undefined}>
        {t(`comingUp.${upcomingState}`)}
      </StatusMessage>}
    </section>
    <footer className="home-low-prominence"><Link to="/analytics">{t("activity.viewInsights")}</Link></footer>
  </div>;
}
