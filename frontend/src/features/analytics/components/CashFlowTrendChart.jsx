import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import { useCashFlowColors } from "../hooks/useCashFlowColors";
import { cashMonthLabel, cashMonthTickParts, formatCash, periodNotes } from "../utils/cashFlowPresentation";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function CashFlowTrendChart({ data }) {
  const { t } = useTranslation("analytics");
  const headingId = useId();
  const tableId = useId();
  const colors = useCashFlowColors();
  const fields = ["paycheckCashInMinor", "otherCashInMinor", "spentMinor"];
  const chartData = {
    labels: data.months.map((bucket) => [...cashMonthTickParts(bucket.month, { t }),
      ...(bucket.month === data.throughDate.slice(0, 7) ? [t("chart.monthToDateTick")] : [])]),
    datasets: [
      { label: t("chart.datasets.paychecks"), stack: "cash-in", backgroundColor: colors.paychecks, borderWidth: 1 },
      { label: t("chart.datasets.other"), stack: "cash-in", backgroundColor: colors.other, borderWidth: 3 },
      { label: t("chart.datasets.spent"), stack: "spent", backgroundColor: colors.spent, borderWidth: 1 },
    ].map((dataset, index) => ({ ...dataset,
      // Numbers are used only by Chart.js for plotting. Tooltips/table use exact strings.
      data: data.months.map((bucket) => Number(bucket[fields[index]]) / 100),
      borderColor: colors.text,
      borderSkipped: false,
    })),
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { stacked: true, ticks: { color: colors.text, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { color: colors.border } },
      y: { stacked: true, beginAtZero: true, ticks: { color: colors.text }, grid: { color: colors.grid }, border: { color: colors.border }, title: { display: true, text: "USD", color: colors.text } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        titleColor: colors.text, bodyColor: colors.text, backgroundColor: colors.surface,
        borderColor: colors.border, borderWidth: 1,
        callbacks: {
          title: (items) => items.length ? cashMonthLabel(data.months[items[0].dataIndex].month, { t }) : "",
          label: (context) => t("chart.tooltipValue", { label: context.dataset.label, amount: formatCash(data.months[context.dataIndex][fields[context.datasetIndex]]) }),
          footer: (items) => items.length ? t("chart.tooltipCashIn", { amount: formatCash(data.months[items[0].dataIndex].cashInMinor) }) : "",
        },
      },
    },
  };

  return (
    <section className="card analytics-panel cash-flow-trend" aria-labelledby={headingId}>
      <p className="analytics-kicker">{data.months.length === 6 ? t("chart.kickerSixMonths") : t("chart.kickerFromFloor", { count: data.months.length, start: cashMonthLabel("0001-01", { t }) })}</p>
      <h2 id={headingId} className="h2">{t("chart.heading")}</h2>
      <ul className="cash-flow-legend" aria-label={t("chart.legendLabel")}>
        <li><span className="cash-flow-swatch cash-flow-bar__paychecks" aria-hidden="true" />{t("chart.datasets.paychecks")}</li>
        <li><span className="cash-flow-swatch cash-flow-bar__other" aria-hidden="true" />{t("chart.datasets.other")}</li>
        <li><span className="cash-flow-swatch cash-flow-bar__spent" aria-hidden="true" />{t("chart.datasets.spent")}</li>
      </ul>
      <div className="cash-flow-trend__canvas" aria-hidden="true"><Bar data={chartData} options={options} /></div>
      {data.months.some((bucket) => bucket.month === data.throughDate.slice(0, 7)) && <p className="muted cash-flow-trend__note">{t("chart.monthToDateNote")}</p>}
      <details className="cash-flow-disclosure">
        <summary>{t("chart.table.summary")}</summary>
        <div className="cash-flow-table-scroll" role="region" aria-labelledby={tableId} tabIndex={0}>
          <table className="cash-flow-table">
            <caption id={tableId}>{t("chart.table.caption")}</caption>
            <thead><tr>
              <th scope="col">{t("chart.table.month")}</th><th scope="col">{t("chart.table.cashIn")}</th><th scope="col">{t("chart.table.paychecks")}</th>
              <th scope="col">{t("chart.table.other")}</th><th scope="col">{t("chart.table.spent")}</th><th scope="col">{t("chart.table.net")}</th><th scope="col">{t("chart.table.note")}</th>
            </tr></thead>
            <tbody>{data.months.map((bucket) => <tr key={bucket.month}>
              <th scope="row">{cashMonthLabel(bucket.month, { t })}</th>
              <td>{formatCash(bucket.cashInMinor)}</td><td>{formatCash(bucket.paycheckCashInMinor)}</td>
              <td>{formatCash(bucket.otherCashInMinor)}</td><td>{formatCash(bucket.spentMinor)}</td>
              <td>{formatCash(bucket.netMinor, { signed: true })}</td><td>{periodNotes(bucket, data.throughDate, { t })}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
