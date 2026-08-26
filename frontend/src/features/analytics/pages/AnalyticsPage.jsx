import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useBudgetLimits } from "../../budgetLimits/hooks/useBudgetLimits";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { formatExpenseDate } from "../../expenses/utils/calendarDate";
import { getMonthYear } from "../../../shared/utils/monthYear";
import { displayText } from "../../../utils/text";
import Card from "../../../shared/ui/Card";
import FormField from "../../../shared/ui/FormField";
import StatusMessage from "../../../shared/ui/StatusMessage";
import {
  buildBudgetStatuses,
  buildMonthlySpendingInsights,
  formatMonthLabel,
  getAvailableMonths,
} from "../utils/monthlySpendingInsights";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatPercentage(value, { signed = false } = {}) {
  if (value === null) return "Not applicable";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default function AnalyticsPage() {
  const [selectedMonth, setSelectedMonth] = useState(getMonthYear(new Date()));
  const {
    expenses, loading: expensesLoading, error: expensesError, refresh: refreshExpenses,
  } = useExpenses();
  const {
    budgetLimits, loading: limitsLoading, error: limitsError, refresh: refreshLimits,
  } = useBudgetLimits(selectedMonth);

  const availableMonths = useMemo(() => getAvailableMonths(expenses), [expenses]);
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
          <p className="page-header__eyebrow">Understand your spending</p>
          <h1>Analytics</h1>
          <p className="muted">See what happened with your recorded spending, month by month.</p>
        </div>
        <FormField label="Month">
          {(id) => (
            <select id={id} value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              {availableMonths.map((month) => (
                <option key={month} value={month}>{formatMonthLabel(month)}</option>
              ))}
            </select>
          )}
        </FormField>
      </header>

      {expensesLoading ? <StatusMessage>Loading spending insights...</StatusMessage> : null}
      {!expensesLoading && expensesError ? (
        <Card as="section" className="section">
          <StatusMessage tone="danger">We couldn’t load recorded expenses.</StatusMessage>
          <button type="button" onClick={retryExpenses}>Try again</button>
        </Card>
      ) : null}

      {!expensesLoading && !expensesError ? (
        <>
          <Card as="section" className="analytics-total" aria-labelledby="monthly-total-heading">
            <p className="analytics-kicker">{formatMonthLabel(selectedMonth)}</p>
            <h2 id="monthly-total-heading" className="h2">Monthly recorded spending</h2>
            <p className="analytics-total__value">{currencyFormatter.format(insights.total)}</p>
            <p className="muted">Total of recorded Expenses for the selected calendar month.</p>
          </Card>

          <div className="analytics-grid">
            <Card as="section" className="analytics-panel" aria-labelledby="category-breakdown-heading">
              <div className="analytics-panel__header">
                <div>
                  <p className="analytics-kicker">Ranked by amount</p>
                  <h2 id="category-breakdown-heading" className="h2">Where the money went</h2>
                </div>
              </div>
              {insights.categories.length === 0 ? (
                <StatusMessage>No recorded spending for this month.</StatusMessage>
              ) : (
                <ol className="analytics-list analytics-category-list">
                  {insights.categories.map((category) => (
                    <li key={category.category} className="analytics-list__item">
                      <div className="analytics-row">
                        <strong>{displayText(category.category)}</strong>
                        <span>{currencyFormatter.format(category.amount)} · {formatPercentage(category.percentage)}</span>
                      </div>
                      <div className="analytics-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(0, Math.min(category.percentage ?? 0, 100))}%` }} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card as="section" className="analytics-panel" aria-labelledby="budget-status-heading">
              <div className="analytics-panel__header">
                <div>
                  <p className="analytics-kicker">Configured limits</p>
                  <h2 id="budget-status-heading" className="h2">Budget status by category</h2>
                </div>
                <Link to="/budgets">Manage budgets</Link>
              </div>
              {limitsLoading ? <StatusMessage>Loading budget limits...</StatusMessage> : null}
              {!limitsLoading && limitsError ? (
                <>
                  <StatusMessage tone="danger">Budget limits are unavailable. Other insights are still shown.</StatusMessage>
                  <button type="button" onClick={refreshLimits}>Try again</button>
                </>
              ) : null}
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
                      <p>{currencyFormatter.format(budget.spent)} spent of {currencyFormatter.format(budget.limitAmount)}</p>
                      <p>{budget.over !== null
                        ? `${currencyFormatter.format(budget.over)} over`
                        : `${currencyFormatter.format(budget.remaining)} remaining`}</p>
                      <p>{budget.percentage === null
                        ? "Percentage used: Not applicable for a $0 limit"
                        : `${formatPercentage(budget.percentage)} used`}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>

            <Card as="section" className="analytics-panel" aria-labelledby="comparison-heading">
              <p className="analytics-kicker">Compared with {formatMonthLabel(insights.previousMonth)}</p>
              <h2 id="comparison-heading" className="h2">Month-over-month change</h2>
              <p className="analytics-comparison__value">
                {insights.comparison.difference > 0 ? "+" : ""}{currencyFormatter.format(insights.comparison.difference)}
              </p>
              {insights.comparison.previousTotal === 0 && insights.total === 0 ? (
                <p className="muted">Neither month has recorded spending.</p>
              ) : insights.comparison.percentage === null ? (
                <p className="muted">Percentage comparison is unavailable because the previous month had $0.00 recorded spending.</p>
              ) : (
                <p className="muted">{formatPercentage(insights.comparison.percentage, { signed: true })} from {currencyFormatter.format(insights.comparison.previousTotal)}</p>
              )}
              {insights.increases.length === 0 && insights.decreases.length === 0 ? (
                <StatusMessage>No category changes to show between these months.</StatusMessage>
              ) : (
                <div className="analytics-change-grid">
                  <div>
                    <h3>Largest increases</h3>
                    {insights.increases.length === 0 ? <p className="muted">No increases.</p> : (
                      <ul>{insights.increases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>+{currencyFormatter.format(change.difference)}</strong></li>)}</ul>
                    )}
                  </div>
                  <div>
                    <h3>Largest decreases</h3>
                    {insights.decreases.length === 0 ? <p className="muted">No decreases.</p> : (
                      <ul>{insights.decreases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>{currencyFormatter.format(change.difference)}</strong></li>)}</ul>
                    )}
                  </div>
                </div>
              )}
            </Card>

            <Card as="section" className="analytics-panel" aria-labelledby="largest-expenses-heading">
              <div className="analytics-panel__header">
                <div>
                  <p className="analytics-kicker">Top five</p>
                  <h2 id="largest-expenses-heading" className="h2">Largest expenses</h2>
                </div>
                <Link to="/transactions">Review transactions</Link>
              </div>
              {insights.largestExpenses.length === 0 ? (
                <StatusMessage>No expenses to rank for this month.</StatusMessage>
              ) : (
                <ol className="analytics-list">
                  {insights.largestExpenses.map((expense) => (
                    <li key={expense.id} className="analytics-list__item analytics-row">
                      <span><strong>{expense.description}</strong><small>{displayText(expense.category)} · {formatExpenseDate(expense.date)}</small></span>
                      <strong>{currencyFormatter.format(expense.amount)}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
