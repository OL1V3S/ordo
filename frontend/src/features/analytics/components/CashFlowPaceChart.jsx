import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Legend } from "chart.js";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { useCashFlowColors } from "../hooks/useCashFlowColors";
import { cashDateLabel, cashMonthLabel, cumulativeDays, formatCash, previousMonth } from "../utils/cashFlowPresentation";

ChartJS.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function CashFlowPaceChart({ data }) {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const headingId = useId();
  const tableId = useId();
  const colors = useCashFlowColors();
  const selected = data.selected;
  const previous = previousMonth(data.months);
  const current = cumulativeDays(selected);
  const before = previous ? cumulativeDays(previous) : [];
  const hasSpending = [current, before].some((points) => points.length > 0 && points[points.length - 1].cumulativeMinor !== "0");
  const heading = (
    <>
      <p className="analytics-kicker">{t("pace.kicker")}</p>
      <h2 id={headingId} className="h2">{t("pace.heading")}</h2>
    </>
  );
  if (current.length === 0 || !hasSpending) {
    return <section className="analytics-panel cash-flow-pace" aria-labelledby={headingId}>{heading}<StatusMessage>{t("pace.empty")}</StatusMessage></section>;
  }

  const series = [
    { month: selected.month, points: current },
    ...(previous ? [{ month: previous.month, points: before }] : []),
  ].map((entry) => ({ ...entry, label: cashMonthLabel(entry.month, { t }) }));
  const longest = Math.max(current.length, before.length);
  const chartData = {
    labels: Array.from({ length: longest }, (_, index) => String(index + 1)),
    datasets: series.map((entry, index) => ({
      label: entry.label,
      // Numbers are used only by Chart.js for plotting. Tooltips/table use exact strings.
      data: entry.points.map((point) => point.plot),
      borderColor: index === 0 ? colors.spent : colors.border,
      backgroundColor: index === 0 ? colors.spent : colors.border,
      borderWidth: 2, borderDash: index === 0 ? [] : [6, 4],
      pointRadius: 2, fill: false, tension: 0,
    })),
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { ticks: { color: colors.text }, grid: { display: false }, border: { color: colors.border } },
      y: { beginAtZero: true, ticks: { color: colors.text }, grid: { color: (context) => context.tick?.value === 0 ? colors.text : colors.grid, lineWidth: (context) => context.tick?.value === 0 ? 2 : 1 }, border: { color: colors.border }, title: { display: true, text: "USD", color: colors.text } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        titleColor: colors.text, bodyColor: colors.text, backgroundColor: colors.surface,
        borderColor: colors.border, borderWidth: 1,
        callbacks: {
          // Months differ in length, so each hovered point is resolved from its own dataset.
          title: (items) => items.length ? cashDateLabel(series[items[0].datasetIndex].points[items[0].dataIndex].date, { t }) : "",
          label: (item) => {
            const point = series[item.datasetIndex].points[item.dataIndex];
            return t("pace.tooltip", {
              label: series[item.datasetIndex].label,
              amount: formatCash(point.spentMinor, { locale }),
              total: formatCash(point.cumulativeMinor, { locale }),
            });
          },
        },
      },
    },
  };
  const spendingDays = current.filter((point) => point.spentMinor !== "0");

  return (
    <section className="analytics-panel cash-flow-pace" aria-labelledby={headingId}>
      {heading}
      <ul className="cash-flow-legend" aria-label={t("chart.legendLabel")}>
        {series.map((entry, index) => (
          <li key={entry.month}>
            <span className={`cash-flow-swatch cash-flow-swatch--pace-${index === 0 ? "current" : "previous"}`} aria-hidden="true" />{entry.label}
          </li>
        ))}
      </ul>
      <div className="cash-flow-pace__canvas" aria-hidden="true"><Line data={chartData} options={options} /></div>
      <details className="cash-flow-disclosure">
        <summary>{t("pace.table.summary")}</summary>
        <div className="cash-flow-table-scroll" role="region" aria-labelledby={tableId} tabIndex={0}>
          <table className="cash-flow-table">
            <caption id={tableId}>{t("pace.table.caption")}</caption>
            <thead><tr>
              <th scope="col">{t("pace.table.date")}</th><th scope="col">{t("pace.table.day")}</th><th scope="col">{t("pace.table.total")}</th>
            </tr></thead>
            <tbody>
              {spendingDays.map((point) => <tr key={point.date}>
                <th scope="row">{cashDateLabel(point.date, { t })}</th>
                <td>{formatCash(point.spentMinor, { locale })}</td><td>{formatCash(point.cumulativeMinor, { locale })}</td>
              </tr>)}
              <tr>
                <th scope="row">{t("chart.table.spent")}</th>
                <td>{formatCash(selected.spentMinor, { locale })}</td><td>{formatCash(selected.spentMinor, { locale })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
