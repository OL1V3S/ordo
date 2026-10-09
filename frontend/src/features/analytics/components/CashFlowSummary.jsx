import { useId } from "react";
import { useTranslation } from "react-i18next";
import { barWidth, cashDateLabel, cashMonthLabel, cashPercentage, formatCash, minorUnits } from "../utils/cashFlowPresentation";

export default function CashFlowSummary({ data }) {
  const { t } = useTranslation("analytics");
  const headingId = useId();
  const bucket = data.selected;
  const maximum = minorUnits(bucket.cashInMinor) > minorUnits(bucket.spentMinor) ? bucket.cashInMinor : bucket.spentMinor;
  const cashInSpent = cashPercentage(bucket.spentMinor, bucket.cashInMinor);
  return (
    <section className="analytics-total cash-flow-summary" aria-labelledby={headingId}>
      <p className="analytics-kicker">{cashMonthLabel(data.month, { t })}</p>
      <h2 id={headingId} className="h2">{t("summary.heading")}</h2>
      {data.month === data.throughDate.slice(0, 7) && <p className="muted">{t("summary.through", { date: cashDateLabel(data.to, { t }) })}</p>}
      <p className="muted">{t("summary.basis")}</p>
      <div className="cash-flow-summary__comparison">
        <div className="cash-flow-comparison">
          <div className="cash-flow-comparison__row">
            <div className="analytics-row"><strong>{t("summary.cashIn")}</strong><strong>{formatCash(bucket.cashInMinor)}</strong></div>
            <div className="cash-flow-bar" aria-hidden="true">
              <span className="cash-flow-bar__paychecks" style={{ width: barWidth(bucket.paycheckCashInMinor, maximum) }} />
              <span className="cash-flow-bar__other" style={{ width: barWidth(bucket.otherCashInMinor, maximum) }} />
            </div>
            {bucket.cashInMinor === "0" && <p className="muted">{t("summary.noCashIn")}</p>}
          </div>
          <div className="cash-flow-comparison__row">
            <div className="analytics-row"><strong>{t("summary.spent")}</strong><strong>{formatCash(bucket.spentMinor)}</strong></div>
            <div className="cash-flow-bar" aria-hidden="true"><span className="cash-flow-bar__spent" style={{ width: barWidth(bucket.spentMinor, maximum) }} /></div>
            {bucket.spentMinor === "0" && <p className="muted">{t("summary.noSpending")}</p>}
          </div>
          <ul className="cash-flow-legend cash-flow-legend--amounts" aria-label={t("summary.breakdownLabel")}>
            <li><span className="cash-flow-swatch cash-flow-bar__paychecks" aria-hidden="true" />{t("summary.confirmedPaychecks")} <strong>{formatCash(bucket.paycheckCashInMinor)}</strong></li>
            <li><span className="cash-flow-swatch cash-flow-bar__other" aria-hidden="true" />{t("summary.otherCashIn")} <strong>{formatCash(bucket.otherCashInMinor)}</strong></li>
          </ul>
        </div>
        <div className="cash-flow-net">
          <h3>{t("summary.netHeading")}</h3>
          <p className="analytics-total__value">{formatCash(bucket.netMinor, { signed: true })}</p>
          <p className="muted">{t("summary.netNote")}</p>
        </div>
      </div>
      <details className="cash-flow-disclosure">
        <summary>{t("summary.about.summary")}</summary>
        <p>{t("summary.about.coverage")}</p>
        <p>{t("summary.about.composition")}</p>
        <p>{t("summary.about.spending")}</p>
        <p>{t("summary.about.history")}</p>
        <dl className="cash-flow-facts">
          <div><dt>{t("summary.facts.cashInSpent")}</dt><dd>{cashInSpent ?? t("summary.facts.notApplicable")}</dd></div>
          <div><dt>{t("summary.facts.confirmedShare")}</dt><dd>{cashPercentage(bucket.paycheckCashInMinor, bucket.cashInMinor) ?? t("summary.facts.notApplicable")}</dd></div>
          <div><dt>{t("summary.facts.otherShare")}</dt><dd>{cashPercentage(bucket.otherCashInMinor, bucket.cashInMinor) ?? t("summary.facts.notApplicable")}</dd></div>
          <div><dt>{t("summary.facts.inflows")}</dt><dd>{t("summary.facts.inflowsValue", { total: bucket.inflowCount, paycheck: bucket.paycheckInflowCount, other: bucket.otherInflowCount })}</dd></div>
          <div><dt>{t("summary.facts.expenses")}</dt><dd>{bucket.expenseCount}</dd></div>
          <div><dt>{t("summary.facts.profiles")}</dt><dd>{bucket.paycheckProfileCount}</dd></div>
          <div><dt>{t("summary.facts.edited")}</dt><dd>{bucket.editedPaycheckInflowCount}</dd></div>
        </dl>
        <p className="muted">{t("summary.about.rounding")}</p>
      </details>
    </section>
  );
}
