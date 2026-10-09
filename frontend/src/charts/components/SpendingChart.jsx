// src/components/charts/SpendingChart.jsx
import { useEffect, useId, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { formatMoneyDecimal } from "../../shared/localization/format";
import { useLocale } from "../../shared/localization/useLocale";
import { AMOUNT_NEEDS_REVIEW } from "../../features/expenses/utils/exactMoney";
import { displayText } from "../../utils/text";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const chartColorProperties = {
  spent: "--chart-spent",
  limit: "--chart-limit",
  text: "--chart-text",
  grid: "--chart-grid",
  border: "--chart-border",
  surface: "--chart-surface",
};

const fallbackChartColors = {
  spent: "#5458c9",
  limit: "#666873",
  text: "#181a20",
  grid: "#e7e8ec",
  border: "#8b8d94",
  surface: "#ffffff",
};

function readChartColors(root) {
  const styles = window.getComputedStyle(root);

  return Object.fromEntries(
    Object.entries(chartColorProperties).map(([name, property]) => [
      name,
      styles.getPropertyValue(property).trim() || fallbackChartColors[name],
    ])
  );
}

function chartColorsMatch(current, next) {
  return Object.keys(chartColorProperties).every(
    (name) => current[name] === next[name]
  );
}

function useChartColors(enabled) {
  const [colors, setColors] = useState(fallbackChartColors);

  useEffect(() => {
    if (!enabled) return undefined;

    const root = document.documentElement;
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    let active = true;
    let updateScheduled = false;

    const updateColors = () => {
      updateScheduled = false;
      if (!active) return;

      const nextColors = readChartColors(root);
      setColors((current) =>
        chartColorsMatch(current, nextColors) ? current : nextColors
      );
    };

    const scheduleColorUpdate = () => {
      if (updateScheduled) return;
      updateScheduled = true;
      queueMicrotask(updateColors);
    };

    const observer = new MutationObserver(scheduleColorUpdate);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    systemTheme?.addEventListener("change", scheduleColorUpdate);

    // ThemeProvider applies a stored theme in an effect. Deferring this read lets
    // that effect update the root before Chart.js receives its first real palette.
    scheduleColorUpdate();

    return () => {
      active = false;
      observer.disconnect();
      systemTheme?.removeEventListener("change", scheduleColorUpdate);
    };
  }, [enabled]);

  return colors;
}

export default function SpendingChart({ totalsByCategory, budgetLimitsByCategory }) {
  const summaryHeadingId = useId();
  const { locale } = useLocale();
  const totals = totalsByCategory ?? {};
  const limits = budgetLimitsByCategory ?? {};

  const categories = Array.from(
    new Set([...Object.keys(totals), ...Object.keys(limits)])
  );
  const chartColors = useChartColors(categories.length > 0);

  if (categories.length === 0) return <p className="empty-state">No data to display chart.</p>;

  const spentAmounts = categories.map((cat) => Number(totals[cat] || 0));
  const limitAmounts = categories.map((cat) =>
    Number(limits[cat]?.limitAmount || 0)
  );

  const data = {
    labels: categories.map((cat) => displayText(cat)),
    datasets: [
      {
        label: "Spent",
        data: spentAmounts,
        backgroundColor: chartColors.spent,
      },
      {
        label: "Budget Limit",
        data: limitAmounts,
        backgroundColor: chartColors.limit,
      },
    ],
  };

  const options = {
    responsive: true,
    scales: {
      x: {
        ticks: { color: chartColors.text },
        grid: { color: chartColors.grid },
        border: { color: chartColors.border },
      },
      y: {
        beginAtZero: true,
        ticks: { color: chartColors.text },
        grid: { color: chartColors.grid },
        border: { color: chartColors.border },
      },
    },
    plugins: {
      legend: {
        position: "top",
        labels: { color: chartColors.text },
      },
      tooltip: {
        enabled: true,
        titleColor: chartColors.text,
        bodyColor: chartColors.text,
        backgroundColor: chartColors.surface,
        borderColor: chartColors.border,
        borderWidth: 1,
      },
    },
  };

  const chartRows = data.labels.map((label, index) => ({
    categoryKey: categories[index],
    label,
    spent: formatMoneyDecimal(totals[categories[index]] || 0, locale) ?? AMOUNT_NEEDS_REVIEW,
    limit: formatMoneyDecimal(limits[categories[index]]?.limitAmount || 0, locale) ?? AMOUNT_NEEDS_REVIEW,
  }));

  return (
    <>
      <div aria-hidden="true">
        <Bar data={data} options={options} />
      </div>
      <section className="chart-summary" aria-labelledby={summaryHeadingId}>
        <h3 id={summaryHeadingId}>Spending and budget limit data</h3>
        <ul className="chart-summary__list">
          {chartRows.map((row) => (
            <li key={row.categoryKey} className="chart-summary__item">
              <strong>{row.label}</strong>
              <span>Spent: {row.spent}</span>
              <span>Budget limit: {row.limit}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
