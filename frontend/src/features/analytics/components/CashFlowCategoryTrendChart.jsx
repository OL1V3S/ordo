import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import StatusMessage from "../../../shared/ui/StatusMessage";
import { displayText } from "../../../utils/text";
import { categoryLabel } from "../../../shared/localization/categoryLabel";
import { useCashFlowColors } from "../hooks/useCashFlowColors";
import { categoryTrend, cashMonthLabel, cashMonthTickParts, formatCash } from "../utils/cashFlowPresentation";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function CashFlowCategoryTrendChart({ data }) {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const headingId = useId();
  const tableId = useId();
  const colors = useCashFlowColors();
  const series = categoryTrend(data.months);
  const heading = (
    <>
      <p className="analytics-kicker">{t("categoryTrend.kicker")}</p>
      <h2 id={headingId} className="h2">{t("categoryTrend.heading")}</h2>
    </>
  );
  if (series.length === 0) {
    return <section className="analytics-panel cash-flow-category-trend" aria-labelledby={headingId}>{heading}<StatusMessage>{t("categoryTrend.empty")}</StatusMessage></section>;
  }

  const palette = [colors.paychecks, colors.other, colors.spent, colors.text, colors.border, colors.limit];
  const labels = series.map((entry) => entry.other
    ? t("categories.donut.other", { count: entry.count })
    : categoryLabel(t, entry.category, displayText));
  const chartData = {
    labels: data.months.map((bucket) => [...cashMonthTickParts(bucket.month, { t }),
      ...(bucket.month === data.throughDate.slice(0, 7) ? [t("chart.monthToDateTick")] : [])]),
    datasets: series.map((entry, index) => ({
      label: labels[index],
      // Numbers are used only by Chart.js for plotting. Tooltips/table use exact strings.
      data: entry.plot,
      backgroundColor: palette[index % palette.length],
      borderColor: colors.surface, borderWidth: 1, borderSkipped: false,
    })),
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { stacked: true, ticks: { color: colors.text, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false }, border: { color: colors.border } },
      y: { stacked: true, beginAtZero: true, ticks: { color: colors.text }, grid: { color: (context) => context.tick?.value === 0 ? colors.text : colors.grid, lineWidth: (context) => context.tick?.value === 0 ? 2 : 1 }, border: { color: colors.border }, title: { display: true, text: "USD", color: colors.text } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        titleColor: colors.text, bodyColor: colors.text, backgroundColor: colors.surface,
        borderColor: colors.border, borderWidth: 1,
        callbacks: {
          title: (items) => items.length ? cashMonthLabel(data.months[items[0].dataIndex].month, { t }) : "",
          label: (item) => t("chart.tooltipValue", {
            label: labels[item.datasetIndex],
            amount: formatCash(series[item.datasetIndex].amounts[item.dataIndex], { locale }),
          }),
          footer: (items) => items.length ? t("categoryTrend.tooltipTotal", { amount: formatCash(data.months[items[0].dataIndex].spentMinor, { locale }) }) : "",
        },
      },
    },
  };

  return (
    <section className="analytics-panel cash-flow-category-trend" aria-labelledby={headingId}>
      {heading}
      <ul className="cash-flow-legend" aria-label={t("chart.legendLabel")}>
        {labels.map((label, index) => (
          <li key={index}><span className="cash-flow-swatch" style={{ background: palette[index % palette.length] }} aria-hidden="true" />{label}</li>
        ))}
      </ul>
      <div className="cash-flow-category-trend__canvas" aria-hidden="true"><Bar data={chartData} options={options} /></div>
      <details className="cash-flow-disclosure">
        <summary>{t("chart.table.summary")}</summary>
        <div className="cash-flow-table-scroll" role="region" aria-labelledby={tableId} tabIndex={0}>
          <table className="cash-flow-table">
            <caption id={tableId}>{t("categoryTrend.table.caption")}</caption>
            <thead><tr>
              <th scope="col">{t("categoryTrend.table.month")}</th>
              {labels.map((label, index) => <th key={index} scope="col">{label}</th>)}
              <th scope="col">{t("categoryTrend.table.spent")}</th>
            </tr></thead>
            <tbody>{data.months.map((bucket, month) => <tr key={bucket.month}>
              <th scope="row">{cashMonthLabel(bucket.month, { t })}</th>
              {series.map((entry, index) => <td key={index}>{formatCash(entry.amounts[month], { locale })}</td>)}
              <td>{formatCash(bucket.spentMinor, { locale })}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
