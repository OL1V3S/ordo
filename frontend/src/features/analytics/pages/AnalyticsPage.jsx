import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatPercentTenths } from "../../../shared/localization/format";
import { useLocale } from "../../../shared/localization/useLocale";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { formatExpenseDate } from "../../expenses/utils/calendarDate";
import { formatExactMoney, formatSignedMoney } from "../../expenses/utils/exactMoney";
import { useCashFlow } from "../hooks/useCashFlow";
import CashFlowSummary from "../components/CashFlowSummary";
import CashFlowCategories from "../components/CashFlowCategories";
import CashFlowTrendChart from "../components/CashFlowTrendChart";
import { cashMonthLabel, localThroughDate } from "../utils/cashFlowPresentation";
import { displayText } from "../../../utils/text";
import { DisclosureButton, DisclosurePanel } from "../../../shared/ui/Disclosure";
import PeriodPicker from "../../../shared/ui/PeriodPicker";
import StatusMessage from "../../../shared/ui/StatusMessage";
import {
  buildMonthlySpendingInsights,
  formatMonthLabel,
} from "../utils/monthlySpendingInsights";
import "../../../styles/analytics.css";

function formatPercentage(value, t, locale, { signed = false } = {}) {
  if (value === null) return t("format.notApplicable");
  const sign = signed && value > 0 ? "+" : "";
  // The ratio is already rounded to one decimal; read its digits exactly, falling back to
  // the plain string for any shape other than -?digits.digit.
  const fixed = value.toFixed(1);
  const match = /^(-?)(\d+)\.(\d)$/.exec(fixed);
  if (!match) return `${sign}${fixed}%`;
  const tenths = BigInt(match[2]) * 10n + BigInt(match[3]);
  return `${sign}${formatPercentTenths(match[1] && tenths !== 0n ? -tenths : tenths, locale)}`;
}

// heading > button + adjacent panel (APG accordion); open state is owned by the page.
function SpendingDisclosure({ id, title, open, onToggle, children }) {
  return (
    <section className="analytics-detail" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="analytics-detail__heading">
        <DisclosureButton controls={`${id}-panel`} open={open} onToggle={() => onToggle(id)} className="analytics-detail__button">
          <span>{title}</span>
          <ChevronDown className="analytics-detail__chevron" size={18} aria-hidden="true" />
        </DisclosureButton>
      </h3>
      <DisclosurePanel id={`${id}-panel`} open={open} className="analytics-detail__content">{children}</DisclosurePanel>
    </section>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const [selectedMonth, setSelectedMonth] = useState(() => localThroughDate().slice(0, 7));
  const cashFlow = useCashFlow(selectedMonth);
  const {
    expenses, loading: expensesLoading, error: expensesError, refresh: refreshExpenses,
  } = useExpenses();
  const [openDetails, setOpenDetails] = useState({ comparison: false, "largest-expenses": false });

  const currentMonth = localThroughDate().slice(0, 7);
  const availableMonths = [...new Set([currentMonth, selectedMonth, ...cashFlow.availableMonths])].sort().reverse();
  const insights = useMemo(
    () => buildMonthlySpendingInsights(expenses, selectedMonth),
    [expenses, selectedMonth]
  );
  const toggleDetail = (id) => setOpenDetails((current) => ({ ...current, [id]: !current[id] }));

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
          <PeriodPicker value={selectedMonth} months={availableMonths} currentValue={currentMonth}
            label={t("page.month")} previousLabel={t("page.earlierMonth")} nextLabel={t("page.laterMonth")}
            currentLabel={t("page.currentMonth")} emptyLabel=""
            formatMonth={(month) => cashMonthLabel(month, { t })} onChange={setSelectedMonth} />
        </div>
      </header>

      <div className="analytics-status">
        {cashFlow.loading ? <StatusMessage>{t("cashFlow.loading")}</StatusMessage> : null}
        {!cashFlow.loading && cashFlow.error ? (
          <>
            <StatusMessage tone="danger">{cashFlow.error}</StatusMessage>
            <button type="button" onClick={cashFlow.refresh}>{t("cashFlow.retry")}</button>
          </>
        ) : null}
        {expensesLoading ? <StatusMessage>{t("spending.loading")}</StatusMessage> : null}
        {!expensesLoading && expensesError ? (
          <>
            <StatusMessage tone="danger">{t("spending.loadError")}</StatusMessage>
            <button type="button" onClick={retryExpenses}>{t("spending.retry")}</button>
          </>
        ) : null}
        {!cashFlow.loading && cashFlow.data ? (
          <div className="analytics-status__actions">
            <button type="button" className="button-ghost" onClick={cashFlow.refresh}>{t("page.refresh")}</button>
          </div>
        ) : null}
      </div>

      <section className="cash-flow-region" aria-label={t("cashFlow.regionLabel")} aria-busy={cashFlow.loading}>
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
        <div className="analytics-budget-line">
          <p>{t("budget.status")}</p>
          <Link to="/budgets">{t("budget.open")}</Link>
        </div>
        {!expensesLoading && !expensesError ? (
          <div className="analytics-details">
            {!insights.available && <StatusMessage tone="warning">{t("spending.inexact")}</StatusMessage>}
            <SpendingDisclosure id="comparison" title={t("comparison.heading")} open={openDetails.comparison} onToggle={toggleDetail}>
                  <p className="analytics-kicker">{t("comparison.kicker", { month: formatMonthLabel(insights.previousMonth, t) })}</p>
                  {!insights.available ? <StatusMessage>{t("comparison.unavailable")}</StatusMessage> : <>
                  <p className="analytics-comparison__value">
                    {insights.comparison.isIncrease ? "+" : ""}{formatSignedMoney(insights.comparison.difference, locale)}
                  </p>
                  {insights.comparison.previousTotal === "0.00" && insights.total === "0.00" ? (
                    <p className="muted">{t("comparison.neither")}</p>
                  ) : insights.comparison.percentage === null ? (
                    <p className="muted">{t("comparison.percentageUnavailable", { amount: formatExactMoney("0.00", { allowZero: true }, locale) })}</p>
                  ) : (
                    <p className="muted">{t("comparison.percentFrom", { percent: formatPercentage(insights.comparison.percentage, t, locale, { signed: true }), amount: formatExactMoney(insights.comparison.previousTotal, { allowZero: true }, locale) })}</p>
                  )}
                  {insights.increases.length === 0 && insights.decreases.length === 0 ? (
                    <StatusMessage>{t("comparison.empty")}</StatusMessage>
                  ) : (
                    <div className="analytics-change-grid">
                      <div>
                        <h4>{t("comparison.increases")}</h4>
                        {insights.increases.length === 0 ? <p className="muted">{t("comparison.noIncreases")}</p> : (
                          <ul>{insights.increases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>+{formatSignedMoney(change.difference, locale)}</strong></li>)}</ul>
                        )}
                      </div>
                      <div>
                        <h4>{t("comparison.decreases")}</h4>
                        {insights.decreases.length === 0 ? <p className="muted">{t("comparison.noDecreases")}</p> : (
                          <ul>{insights.decreases.map((change) => <li key={change.category}>{displayText(change.category)} <strong>{formatSignedMoney(change.difference, locale)}</strong></li>)}</ul>
                        )}
                      </div>
                    </div>
                  )}
                  </>}
            </SpendingDisclosure>

            <SpendingDisclosure id="largest-expenses" title={t("largest.heading")} open={openDetails["largest-expenses"]} onToggle={toggleDetail}>
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
                          <span><strong>{expense.description}</strong><small>{displayText(expense.category)} · {formatExpenseDate(expense.date, locale)}</small></span>
                          <strong>{formatExactMoney(expense.amount, undefined, locale)}</strong>
                        </li>
                      ))}
                    </ol>
                  )}
            </SpendingDisclosure>
          </div>
        ) : null}
      </section>
    </div>
  );
}
