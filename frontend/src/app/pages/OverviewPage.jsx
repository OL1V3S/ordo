import { Link } from "react-router-dom";
import { useHomeRead } from "../hooks/useHomeRead";
import { useCashFlow } from "../../features/analytics/hooks/useCashFlow";
import CashFlowSummary from "../../features/analytics/components/CashFlowSummary";
import { cashDateLabel, localThroughDate } from "../../features/analytics/utils/cashFlowPresentation";
import { budgetLimitsApi } from "../../features/budgetLimits/api/budgetLimitsApi";
import { computeMonthlyTotalsByCategory } from "../../features/budgetLimits/utils/totalsByCategory";
import { expensesApi } from "../../features/expenses/api/expensesApi";
import { formatExpenseDate } from "../../features/expenses/utils/calendarDate";
import {
  formatCents,
  formatExactMoney,
  parseBudgetLimit,
  parseExactMoney,
  percentageFromRatio,
} from "../../features/expenses/utils/exactMoney";
import { paychecksApi } from "../../features/paychecks/api/paychecksApi";
import { cadenceLabel, formatAmount, formatDate, formatMoney } from "../../features/paychecks/utils/formatPaychecks";
import { commitmentsApi } from "../../features/commitments/api/commitmentsApi";
import { getMonthYear } from "../../shared/utils/monthYear";
import { displayText } from "../../utils/text";
import StatusMessage from "../../shared/ui/StatusMessage";

async function readList(request) {
  const response = await request;
  if (!Array.isArray(response.data)) throw new Error("List unavailable");
  return response;
}
const loadExpenses = () => readList(expensesApi.getAll());
const loadLimits = (month) => readList(budgetLimitsApi.getByMonth(month));
const loadCommitments = () => readList(commitmentsApi.getCommitments());
const loadPaychecks = async () => {
  const response = await paychecksApi.getPaychecks();
  if (!Array.isArray(response.data?.paychecks)) throw new Error("Paychecks unavailable");
  return response;
};
const ready = (read) => !read.loading && !read.error && read.data !== null;
const compareIds = (left, right) => String(left.id).localeCompare(String(right.id), "en");

function ReadStatus({ read, label }) {
  if (read.error) return (
    <div className="home-read-status">
      <StatusMessage tone="danger">We couldn’t load {label}.</StatusMessage>
      <button type="button" onClick={read.refresh}>Retry {label}</button>
    </div>
  );
  return read.loading ? <StatusMessage>Loading {label}...</StatusMessage> : null;
}

function HomeModule({ id, title, href, linkText, children }) {
  return (
    <section className="card home-module" aria-labelledby={id}>
      <h2 id={id} className="h2">{title}</h2>
      <div className="home-module__content">{children}</div>
      <Link to={href}>{linkText} <span aria-hidden="true">→</span></Link>
    </section>
  );
}

export default function OverviewPage() {
  const currentMonth = getMonthYear(new Date());
  const cashFlow = useCashFlow(currentMonth);
  const spending = useHomeRead(loadExpenses, currentMonth);
  const limits = useHomeRead(loadLimits, currentMonth);
  const paychecks = useHomeRead(loadPaychecks);
  const commitments = useHomeRead(loadCommitments);
  // Secondary reads are independent. If cash flow is unavailable, recent spending
  // still uses an explicitly labelled local-calendar cutoff, never a guessed total.
  const throughDate = cashFlow.data?.to ?? localThroughDate();

  const totalsByCategory = computeMonthlyTotalsByCategory(spending.data ?? [], currentMonth);
  const budgetComparisons = (limits.data ?? []).map((limit) => {
    const spent = parseExactMoney(
      totalsByCategory[limit.category] === undefined ? "0.00" : totalsByCategory[limit.category],
      { allowZero: true }
    );
    const parsedLimit = parseBudgetLimit(limit.limitAmount);
    if (!spent || !parsedLimit) return { limit, available: false };
    return {
      limit, spent, parsedLimit, available: true,
      percentage: parsedLimit.cents === 0n ? null : percentageFromRatio(spent.cents, parsedLimit.cents),
      needsAttention: parsedLimit.cents > 0n && spent.cents * 100n >= parsedLimit.cents * 90n,
    };
  });
  const attention = budgetComparisons.filter((comparison) => comparison.available && comparison.needsAttention);
  const unavailableBudgetCount = budgetComparisons.filter((comparison) => !comparison.available).length;
  const expectedPaychecks = (paychecks.data?.paychecks ?? [])
    .filter((profile) => profile.lifecycle === "active" && profile.nextProjection)
    .sort((left, right) => left.nextProjection.earliestExpectedDate.localeCompare(right.nextProjection.earliestExpectedDate) || compareIds(left, right))
    .slice(0, 2);
  const activeCommitments = (commitments.data ?? []).filter((commitment) => commitment.lifecycle === "active");
  const recentSpending = (spending.data ?? [])
    .filter((expense) => expense.date.startsWith(`${currentMonth}-`) && expense.date <= throughDate)
    .sort((left, right) => right.date.localeCompare(left.date) || compareIds(left, right))
    .slice(0, 3);

  return (
    <div className="shell-page home-page">
      <header className="page-header home-page__header">
        <div><h1>Home</h1><p className="muted">This month, at a glance.</p></div>
        <Link className="button-link" to="/transactions">Open activity <span aria-hidden="true">→</span></Link>
      </header>

      <section className="home-cash-flow" aria-label="This month’s recorded cash flow" aria-busy={cashFlow.loading}>
        <div className="home-cash-flow__actions">
          <Link to="/analytics">View insights <span aria-hidden="true">→</span></Link>
          {ready(cashFlow) && <button type="button" className="button-ghost" onClick={cashFlow.refresh}>Refresh cash flow</button>}
        </div>
        {cashFlow.loading && <StatusMessage>Loading recorded cash flow...</StatusMessage>}
        {cashFlow.error && <div className="home-read-status"><StatusMessage tone="danger">{cashFlow.error}</StatusMessage><button type="button" onClick={cashFlow.refresh}>Retry cash flow</button></div>}
        {ready(cashFlow) && <CashFlowSummary data={cashFlow.data} />}
      </section>

      <div className="home-modules">
        <HomeModule id="home-paychecks-heading" title="Expected paychecks" href="/paychecks" linkText="All paychecks">
          <ReadStatus read={paychecks} label="expected paychecks" />
          {ready(paychecks) && (expectedPaychecks.length === 0 ? (
            <StatusMessage>No expected paycheck windows are available.</StatusMessage>
          ) : (
            <>
              <p className="home-qualification">Expected, not guaranteed.</p>
              <ul className="home-records">
                {expectedPaychecks.map((profile) => {
                  const projection = profile.nextProjection;
                  return (
                    <li key={profile.id}>
                      <div className="home-record__line"><strong>{profile.displayName}</strong><strong>{formatAmount(projection.amount)}</strong></div>
                      <p>{cadenceLabel(profile.schedule?.cadence)}</p>
                      <p>Expected {formatDate(projection.earliestExpectedDate)}{projection.latestExpectedDate !== projection.earliestExpectedDate && ` – ${formatDate(projection.latestExpectedDate)}`}</p>
                    </li>
                  );
                })}
              </ul>
              <details className="home-disclosure">
                <summary>About these expectations</summary>
                <p>Evaluated {formatDate(paychecks.data.evaluatedOn)}. Expected windows can overlap; their order does not guarantee which deposit arrives first.</p>
              </details>
            </>
          ))}
        </HomeModule>

        <HomeModule id="home-budgets-heading" title="Budget attention" href="/budgets" linkText="All budgets">
          <ReadStatus read={spending} label="spending" />
          <ReadStatus read={limits} label="budget limits" />
          {ready(spending) && ready(limits) && (limits.data.length === 0 ? (
            <StatusMessage>No budget limits are set for this month.</StatusMessage>
          ) : attention.length === 0 && unavailableBudgetCount > 0 ? (
            <StatusMessage tone="warning">Budget attention is unavailable for {unavailableBudgetCount} {unavailableBudgetCount === 1 ? "limit" : "limits"} whose exact cents could not be verified.</StatusMessage>
          ) : attention.length === 0 ? (
            <StatusMessage>No limits are at or above 90% used.</StatusMessage>
          ) : (
            <>
              <p className="muted">{attention.length} {attention.length === 1 ? "limit is" : "limits are"} at or above 90% used · {limits.data.length} {limits.data.length === 1 ? "limit" : "limits"} set</p>
              <ul className="home-records">
                {attention.slice(0, 3).map((comparison, index) => {
                  const { limit, spent, parsedLimit, percentage } = comparison;
                  return (
                    <li key={limit.id ?? index}>
                      <div className="home-record__line"><strong>{displayText(limit.category)}</strong><span>{percentage.toFixed(1)}% used</span></div>
                      <p>{formatCents(spent.cents)} spent of {formatCents(parsedLimit.cents)}</p>
                    </li>
                  );
                })}
              </ul>
              {unavailableBudgetCount > 0 && <p className="muted">{unavailableBudgetCount} additional {unavailableBudgetCount === 1 ? "limit needs" : "limits need"} review before budget attention can be calculated.</p>}
            </>
          ))}
        </HomeModule>

        <HomeModule id="home-commitments-heading" title="Active commitments" href="/commitments" linkText="All commitments">
          <ReadStatus read={commitments} label="active commitments" />
          {ready(commitments) && (activeCommitments.length === 0 ? (
            <StatusMessage>No active commitments.</StatusMessage>
          ) : (
            <>
              <p className="muted">{activeCommitments.length} active {activeCommitments.length === 1 ? "commitment" : "commitments"}</p>
              <ul className="home-records">
                {activeCommitments.slice(0, 3).map((commitment) => (
                  <li key={commitment.id}>
                    <div className="home-record__line"><strong>{commitment.name}</strong><strong>{commitment.amountMode === "fixed" ? formatMoney(commitment.expectedAmount) : `${formatMoney(commitment.expectedMinimumAmount)}–${formatMoney(commitment.expectedMaximumAmount)}`}</strong></div>
                    <p>{displayText(commitment.cadence)}</p>
                  </li>
                ))}
              </ul>
            </>
          ))}
        </HomeModule>

        <HomeModule id="home-spending-heading" title="Recent spending" href="/transactions" linkText="All spending">
          <ReadStatus read={spending} label="spending" />
          {ready(spending) && <>
            <p className="muted">This month · Through {cashDateLabel(throughDate)}</p>
            {recentSpending.length === 0 ? <StatusMessage>No spending recorded in this period.</StatusMessage> : (
              <ul className="home-records">
                {recentSpending.map((expense) => (
                  <li key={expense.id}>
                    <div className="home-record__line"><strong>{expense.description}</strong><strong>{formatExactMoney(expense.amount)}</strong></div>
                    <p>{formatExpenseDate(expense.date)} · {displayText(expense.category)}</p>
                  </li>
                ))}
              </ul>
            )}
          </>}
        </HomeModule>
      </div>
    </div>
  );
}
