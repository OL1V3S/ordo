import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { useBudgetLimits } from "../hooks/useBudgetLimits";
import { computeMonthlyTotalsByCategory } from "../utils/totalsByCategory";
import { getMonthYear } from "../../../shared/utils/monthYear";
import BudgetLimitsPanel from "../components/BudgetLimitsPanel";
import "../../../styles/budgets.css";

export default function BudgetsPage() {
  const { t } = useTranslation("budgets");
  const { expenses, loading: spendingLoading, error: spendingError, refresh: refreshSpending } = useExpenses();
  const [limitMonthYear, setLimitMonthYear] = useState(getMonthYear(new Date()));
  const {
    budgetLimits,
    loading: limitsLoading,
    error: limitsError,
    refresh: refreshLimits,
    upsertLimit,
    deleteLimit,
  } = useBudgetLimits(limitMonthYear);

  const totalsByCategory = useMemo(
    () => computeMonthlyTotalsByCategory(expenses, limitMonthYear),
    [expenses, limitMonthYear]
  );

  return (
    <div className="container budgets-page">
      <header className="page-header">
        <div>
          <h1>{t("page.title")}</h1>
          <p className="muted">{t("page.description")}</p>
        </div>
      </header>

      <BudgetLimitsPanel
        limitMonthYear={limitMonthYear}
        setLimitMonthYear={setLimitMonthYear}
        budgetLimits={budgetLimits}
        limitsLoading={limitsLoading}
        limitsError={limitsError}
        refreshLimits={refreshLimits}
        spendingLoading={spendingLoading}
        spendingError={spendingError}
        refreshSpending={refreshSpending}
        totalsByCategory={totalsByCategory}
        upsertLimit={upsertLimit}
        deleteLimit={deleteLimit}
      />
    </div>
  );
}
