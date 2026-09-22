import { useMemo, useState } from "react";
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

function formatPercentage(value, { signed = false } = {}) {
  if (value === null) return "Not applicable";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default function AnalyticsPage() {
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
          <h1>Insights</h1>
          <p className="muted">See recorded cash in and spending, month by month.</p>
        </div>
        <div className="analytics-page__controls">
          <FormField label="Month">
            {(id) => (
              <select id={id} value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{cashMonthLabel(month)}</option>
                ))}
              </select>
            )}
          </FormField>
          {!cashFlow.loading && cashFlow.data ? (
            <button type="button" className="button-ghost" onClick={cashFlow.refresh}>Refresh cash flow</button>
          ) : null}
        </div>
      </header>

      <section className="cash-flow-region" aria-label="Recorded cash flow" aria-busy={cashFlow.loading}>
        {cashFlow.loading ? <StatusMessage>Loading recorded cash flow...</StatusMessage> : null}
        {!cashFlow.loading && cashFlow.error ? (
          <div className="card analytics-panel">
            <StatusMessage tone="danger">{cashFlow.error}</StatusMessage>
            <button type="button" onClick={cashFlow.refresh}>Retry cash flow</button>
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
          <h2 id="more-spending-heading" className="h2">More spending detail</h2>
        </header>
        {expensesLoading ? <StatusMessage>Loading spending insights...</StatusMessage> : null}
        {!expensesLoading && expensesError ? (
          <div className="analytics-load-state">
            <StatusMessage tone="danger">We couldn’t load recorded expenses.</StatusMessage>
            <button type="button" onClick={retryExpenses}>Try again</button>
          </div>
        ) : null}

        {!expensesLoading && !expensesError ? (
          <div className="analytics-details">
            {!insights.available && <StatusMessage tone="warning">Some Expense amounts could not be verified exactly. Affected spending comparisons are unavailable.</StatusMessage>}
            <section className="analytics-detail" aria-labelledby="budget-status-heading">
              <details>
                <summary><h3 id="budget-status-heading">Budget status by category</h3></summary>
                <div className="analytics-detail__content">
                  <div className="analytics-panel__header">
                    <div>
                      <p className="analytics-kicker">Configured limits</p>
                    </div>
                    <Link to="/budgets">Manage budgets</Link>
                  </div>
                  {!limitsLoading && !limitsError && budgetStatuses.length === 0 ? (
                    <StatusMessage>No budget limits are set for this month.</StatusMessage>
                  ) : null}
                  {!limitsLoading && !limitsError && budgetStatuses.length > 0 ? (
                    <ul className="analytics-list">
                      {budgetStatuses.map((budget) => (
                        <li key={budget.id ?? budget.category} className="analytics-list__item analytics-budget-row">
                          <div className="analytics-row">
                            <strong>{displayText(budget.category)}</strong>
                            <span className={`analytics-status analytics-status--${budget.status.replace(" ", "-")}`}>{displayText(budget.status)}</span>
                          </div>
                          {!budget.available ? (
                            <p>Exact comparison unavailable. Review the limit or spending amount.</p>
                          ) : <>
                            <p>{formatExactMoney(budget.spent, { allowZero: true })} spent of {formatExactMoney(budget.limitAmount, { allowZero: true })}</p>
                            <p>{budget.over !== null
                              ? `${formatExactMoney(budget.over, { allowZero: true })} over`
                              : `${formatExactMoney(budget.remaining, { allowZero: true })} remaining`}</p>
                            <p>{budget.percentage === null
                              ? "Percentage used: Not applicable for a $0 limit"
                              : `${formatPercentage(budget.percentage)} used`}</p>
                          </>}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
              {limitsLoading ? <StatusMessage>Loading budget limits...</StatusMessage> : null}
              {!limitsLoading && limitsError ? (
                <>
                  <StatusMessage tone="danger">Budget limits are unavailable. Other insights are still shown.</StatusMessage>
                  <button type="button" onClick={refreshLimits}>Try again</button>
                </>
              ) : null}
            </section>

            <section className="analytics-detail" aria-labelledby="comparison-heading">
              <details>
                <summary><h3 id="comparison-heading">Month-over-month change</h3></summary>
                <div className="analytics-detail__content">
                  <p className="analytics-kicker">Compared with {formatMonthLabel(insights.previousMonth)}</p>
                  {!insights.available ? <StatusMessage>Exact month-over-month comparison is unavailable.</StatusMessage> : <>
                  <p className="analytics-comparison__value">
                    {insights.comparison.isIncrease ? "+" : ""}{formatSignedMoney(insights.comparison.difference)}
                  </p>
                  {insights.comparison.previousTotal === "0.00" && insights.total === "0.00" ? (
                    <p className="muted">Neither month has recorded spending.</p>
                  ) : insights.comparison.percentage === null ? (
                    <p className="muted">Percentage comparison is unavailable because the previous month had $0.00 recorded spending.</p>
                  ) : (
                    <p className="muted">{formatPercentage(insights.comparison.percentage, { signed: true })} from {formatExactMoney(insights.comparison.previousTotal, { allowZero: true })}</p>
                  )}
                  {insights.increases.length === 0 && insights.decreases.length === 0 ? (
                    <StatusMessage>No category changes to show between these months.</StatusMessage>
                  ) : (
                    <div className="analytics-change-grid">
                      <div>
                        <h4>Largest increases</h4>
                        {insights.increases.length === 0 ? <p className="muted">No increases.</p> : (
                          <ul>{insights.increases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>+{formatSignedMoney(change.difference)}</strong></li>)}</ul>
                        )}
                      </div>
                      <div>
                        <h4>Largest decreases</h4>
                        {insights.decreases.length === 0 ? <p className="muted">No decreases.</p> : (
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
                <summary><h3 id="largest-expenses-heading">Largest expenses</h3></summary>
                <div className="analytics-detail__content">
                  <div className="analytics-panel__header">
                    <div>
                      <p className="analytics-kicker">Top five</p>
                    </div>
                    <Link to="/transactions">Review activity</Link>
                  </div>
                  {insights.largestExpenses.length === 0 ? (
                    <StatusMessage>No expenses to rank for this month.</StatusMessage>
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
