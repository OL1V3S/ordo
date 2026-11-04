import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, DoughnutController, Tooltip, Legend, Title } from "chart.js";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { displayText } from "../../../utils/text";
import { categoryLabel } from "../../../shared/localization/categoryLabel";
import { useCashFlowColors } from "../hooks/useCashFlowColors";
import { cashPercentage, formatCash } from "../utils/cashFlowPresentation";

ChartJS.register(DoughnutController, ArcElement, Tooltip, Legend, Title);

// Decorative overview of the ranked list below it, which carries every exact amount.
export default function CashFlowCategoryDonut({ shares, spentMinor }) {
  const { t } = useTranslation("analytics");
  const { locale } = useLocale();
  const colors = useCashFlowColors();
  const palette = [colors.paychecks, colors.other, colors.spent, colors.text, colors.border, colors.limit];
  const labels = shares.map((share) => share.other
    ? t("categories.donut.other", { count: share.count })
    : categoryLabel(t, share.category, displayText));
  const chartData = {
    labels,
    datasets: [{
      // Numbers are used only by Chart.js for plotting. Tooltips use exact strings.
      data: shares.map((share) => Number(share.amountMinor)),
      backgroundColor: shares.map((_, index) => palette[index % palette.length]),
      borderColor: colors.surface,
      borderWidth: 2,
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    cutout: "60%",
    plugins: {
      title: { display: true, text: t("categories.donut.label"), color: colors.text },
      legend: { position: "bottom", labels: { color: colors.text } },
      tooltip: {
        titleColor: colors.text, bodyColor: colors.text, backgroundColor: colors.surface,
        borderColor: colors.border, borderWidth: 1,
        callbacks: {
          label: (context) => {
            const share = shares[context.dataIndex];
            const percent = cashPercentage(share.amountMinor, spentMinor, locale) ?? t("categories.notApplicable");
            return `${labels[context.dataIndex]}: ${formatCash(share.amountMinor, { locale })} · ${percent}`;
          },
        },
      },
    },
  };
  return <div className="cash-flow-donut" aria-hidden="true"><Doughnut data={chartData} options={options} /></div>;
}
