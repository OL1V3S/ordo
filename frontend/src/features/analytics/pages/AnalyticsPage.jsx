import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useBudgetLimits } from "../../budgetLimits/hooks/useBudgetLimits";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { formatExpenseDate } from "../../expenses/utils/calendarDate";
import { formatExactMoney, formatSignedMoney } from "../../expenses/utils/exactMoney";
import { useCashFlow } from "../hooks/useCashFlow";
import CashFlowSummary from "../components/CashFlowSummary";
import CashFlowCategories from "../components/CashFlowCategories";
import CashFlowTrendChart from "../components/CashFlowTrendChart";
import { cashMonthLabel, localThroughDate } from "../utils/cashFlowPresentation";
import { displayText } from "../../../utils/text";
import FormField from "../../../shared/ui/FormField";
import StatusMessage from "../../../shared/ui/StatusMessage";
import {
  buildBudgetStatuses,
  buildMonthlySpendingInsights,
  formatMonthLabel,
} from "../utils/monthlySpendingInsights";

const BUDGET_STATUS_KEYS = {
  "over budget": "overBudget", "near limit": "nearLimit", "on track": "onTrack", unavailable: "unavailable",
};

function formatPercentage(value, t, { signed = false } = {}) {
  if (value === null) return t("format.notApplicable");
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default function AnalyticsPage() {
  const { t } = useTranslation("analytics");
  const [selectedMonth, setSelectedMonth] = useState(() => localThroughDate().slice(0, 7));
  const cashFlow = useCashFlow(selectedMonth);
  const {
    expenses, loading: expensesLoading, error: expensesError, refresh: refreshExpenses,
  } = useExpenses();
  const {
    budgetLimits, loading: limitsLoading, error: limitsError, refresh: refreshLimits,
  } = useBudgetLimits(selectedMonth);

  const availableMonths = [...new Set([localThroughDate().slice(0, 7), selectedMonth, ...cashFlow.availableMonths])].sort().reverse();
  const insights = useMemo(
    () => buildMonthlySpendingInsights(expenses, selectedMonth),
    [expenses, selectedMonth]
  );
  const budgetStatuses = useMemo(
    () => buildBudgetStatuses(budgetLimits, insights.totalsByCategory),
    [budgetLimits, insights.totalsByCategory]
  );

  async function retryExpenses() {
    try {
      await refreshExpenses();
    } catch {
      // The hook owns the user-facing error state.
    }
  }

  return (
    <div className="container analytics-page">
      <header className="page-header analytics-page__header">
        <div>
          <h1>{t("page.title")}</h1>
          <p className="muted">{t("page.description")}</p>
        </div>
        <div className="analytics-page__controls">
          <FormField label={t("page.month")}>
            {(id) => (
              <select id={id} value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{cashMonthLabel(month, { t })}</option>
                ))}
              </select>
            )}
          </FormField>
          {!cashFlow.loading && cashFlow.data ? (
            <button type="button" className="button-ghost" onClick={cashFlow.refresh}>{t("page.refresh")}</button>
          ) : null}
        </div>
      </header>

      <section className="cash-flow-region" aria-label={t("cashFlow.regionLabel")} aria-busy={cashFlow.loading}>
        {cashFlow.loading ? <StatusMessage>{t("cashFlow.loading")}</StatusMessage> : null}
        {!cashFlow.loading && cashFlow.error ? (
          <div className="card analytics-panel">
            <StatusMessage tone="danger">{cashFlow.error}</StatusMessage>
            <button type="button" onClick={cashFlow.refresh}>{t("cashFlow.retry")}</button>
          </div>
        ) : null}
        {!cashFlow.loading && cashFlow.data ? (
          <>
            <CashFlowSummary data={cashFlow.data} />
            <div className="cash-flow-visuals">
              <CashFlowCategories data={cashFlow.data} />
              <CashFlowTrendChart data={cashFlow.data} />
            </div>
          </>
        ) : null}
      </section>

      <section className="analytics-more" aria-labelledby="more-spending-heading">
        <header className="analytics-more__header">
          <h2 id="more-spending-heading" className="h2">{t("spending.heading")}</h2>
        </header>
        {expensesLoading ? <StatusMessage>{t("spending.loading")}</StatusMessage> : null}
        {!expensesLoading && expensesError ? (
          <div className="analytics-load-state">
            <StatusMessage tone="danger">{t("spending.loadError")}</StatusMessage>
            <button type="button" onClick={retryExpenses}>{t("spending.retry")}</button>
          </div>
        ) : null}

        {!expensesLoading && !expensesError ? (
          <div className="analytics-details">
            {!insights.available && <StatusMessage tone="warning">{t("spending.inexact")}</StatusMessage>}
            <section className="analytics-detail" aria-labelledby="budget-status-heading">
              <details>
                <summary><h3 id="budget-status-heading">{t("budget.heading")}</h3></summary>
                <div className="analytics-detail__content">
                  <div className="analytics-panel__header">
                    <div>
                      <p className="analytics-kicker">{t("budget.kicker")}</p>
                    </div>
                    <Link to="/budgets">{t("budget.manage")}</Link>
                  </div>
                  {!limitsLoading && !limitsError && budgetStatuses.length === 0 ? (
                    <StatusMessage>{t("budget.empty")}</StatusMessage>
                  ) : null}
                  {!limitsLoading && !limitsError && budgetStatuses.length > 0 ? (
                    <ul className="analytics-list">
                      {budgetStatuses.map((budget) => (
                        <li key={budget.id ?? budget.category} className="analytics-list__item analytics-budget-row">
                          <div className="analytics-row">
                            <strong>{displayText(budget.category)}</strong>
                            <span className={`analytics-status analytics-status--${budget.status.replace(" ", "-")}`}>{t(`budget.status.${BUDGET_STATUS_KEYS[budget.status]}`)}</span>
                          </div>
                          {!budget.available ? (
                            <p>{t("budget.comparisonUnavailable")}</p>
                          ) : <>
                            <p>{t("budget.spentOf", { spent: formatExactMoney(budget.spent, { allowZero: true }), limit: formatExactMoney(budget.limitAmount, { allowZero: true }) })}</p>
                            <p>{budget.over !== null
                              ? t("budget.over", { amount: formatExactMoney(budget.over, { allowZero: true }) })
                              : t("budget.remaining", { amount: formatExactMoney(budget.remaining, { allowZero: true }) })}</p>
                            <p>{budget.percentage === null
                              ? t("budget.zeroLimit")
                              : t("budget.percentUsed", { percent: formatPercentage(budget.percentage, t) })}</p>
                          </>}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
              {limitsLoading ? <StatusMessage>{t("budget.loading")}</StatusMessage> : null}
              {!limitsLoading && limitsError ? (
                <>
                  <StatusMessage tone="danger">{t("budget.unavailable")}</StatusMessage>
                  <button type="button" onClick={refreshLimits}>{t("budget.retry")}</button>
                </>
              ) : null}
            </section>

            <section className="analytics-detail" aria-labelledby="comparison-heading">
              <details>
                <summary><h3 id="comparison-heading">{t("comparison.heading")}</h3></summary>
                <div className="analytics-detail__content">
                  <p className="analytics-kicker">{t("comparison.kicker", { month: formatMonthLabel(insights.previousMonth, t) })}</p>
                  {!insights.available ? <StatusMessage>{t("comparison.unavailable")}</StatusMessage> : <>
                  <p className="analytics-comparison__value">
                    {insights.comparison.isIncrease ? "+" : ""}{formatSignedMoney(insights.comparison.difference)}
                  </p>
                  {insights.comparison.previousTotal === "0.00" && insights.total === "0.00" ? (
                    <p className="muted">{t("comparison.neither")}</p>
                  ) : insights.comparison.percentage === null ? (
                    <p className="muted">{t("comparison.percentageUnavailable")}</p>
                  ) : (
                    <p className="muted">{t("comparison.percentFrom", { percent: formatPercentage(insights.comparison.percentage, t, { signed: true }), amount: formatExactMoney(insights.comparison.previousTotal, { allowZero: true }) })}</p>
                  )}
                  {insights.increases.length === 0 && insights.decreases.length === 0 ? (
                    <StatusMessage>{t("comparison.empty")}</StatusMessage>
                  ) : (
                    <div className="analytics-change-grid">
                      <div>
                        <h4>{t("comparison.increases")}</h4>
                        {insights.increases.length === 0 ? <p className="muted">{t("comparison.noIncreases")}</p> : (
                          <ul>{insights.increases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>+{formatSignedMoney(change.difference)}</strong></li>)}</ul>
                        )}
                      </div>
                      <div>
                        <h4>{t("comparison.decreases")}</h4>
                        {insights.decreases.length === 0 ? <p className="muted">{t("comparison.noDecreases")}</p> : (
                          <ul>{insights.decreases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>{formatSignedMoney(change.difference)}</strong></li>)}</ul>
                        )}
                      </div>
                    </div>
                  )}
                  </>}
                </div>
              </details>
            </section>

            <section className="analytics-detail" aria-labelledby="largest-expenses-heading">
              <details>
                <summary><h3 id="largest-expenses-heading">{t("largest.heading")}</h3></summary>
                <div className="analytics-detail__content">
                  <div className="analytics-panel__header">
                    <div>
                      <p className="analytics-kicker">{t("largest.kicker")}</p>
                    </div>
                    <Link to="/transactions">{t("largest.review")}</Link>
                  </div>
                  {!insights.largestExpensesAvailable ? (
                    <StatusMessage>{t("largest.unavailable")}</StatusMessage>
                  ) : insights.largestExpenses.length === 0 ? (
                    <StatusMessage>{t("largest.empty")}</StatusMessage>
                  ) : (
                    <ol className="analytics-list">
                      {insights.largestExpenses.map((expense) => (
                        <li key={expense.id} className="analytics-list__item analytics-row">
                          <span><strong>{expense.description}</strong><small>{displayText(expense.category)} · {formatExpenseDate(expense.date)}</small></span>
                          <strong>{formatExactMoney(expense.amount)}</strong>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </details>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
