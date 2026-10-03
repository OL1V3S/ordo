import { useTranslation } from "react-i18next";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import Card from "../../../shared/ui/Card";
import FormField from "../../../shared/ui/FormField";

const DATE_FILTER_SUMMARY_KEYS = {
  last7: "expenseFilters.summary.last7",
  last30: "expenseFilters.summary.last30",
  thisMonth: "expenseFilters.summary.thisMonth",
};

export default function ExpenseFilters({
  searchTerm,
  setSearchTerm,
  dateFilter,
  setDateFilter,
  customStartDate,
  setCustomStartDate,
  customEndDate,
  setCustomEndDate,
  categoryFilter,
  setCategoryFilter,
}) {
  const { t } = useTranslation("activity");
  const trimmedSearchTerm = searchTerm.trim();
  const customDateLabel = [customStartDate, customEndDate].filter(Boolean).join(" – ");
  const categoryLabel = (value) => t(`categories.${value.toLowerCase()}`, { defaultValue: value });
  const dateFilterLabel = dateFilter === "all" ? ""
    : dateFilter === "custom"
      ? (customDateLabel ? t("expenseFilters.summary.customWithRange", { range: customDateLabel }) : t("expenseFilters.summary.custom"))
      : t(DATE_FILTER_SUMMARY_KEYS[dateFilter]);
  const activeFilters = [
    trimmedSearchTerm ? t("expenseFilters.summary.search", { term: trimmedSearchTerm }) : "",
    dateFilter !== "all" ? dateFilterLabel : "",
    categoryFilter ? t("expenseFilters.summary.category", { category: categoryLabel(categoryFilter) }) : "",
  ].filter(Boolean);

  function clearFilters() {
    setSearchTerm("");
    setDateFilter("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setCategoryFilter("");
  }

  return (
    <Card className="section card--subtle expense-filters">
      <div className="expense-filters__primary">
        <FormField label={t("expenseFilters.searchLabel")} className="expense-filters__search">
          {(id) => (
            <input
              id={id}
              type="search"
              placeholder={t("expenseFilters.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          )}
        </FormField>
        {activeFilters.length > 0 ? (
          <button type="button" className="button-ghost expense-filters__clear" onClick={clearFilters}>
            {t("expenseFilters.clear")}
          </button>
        ) : null}
      </div>

      {activeFilters.length > 0 ? (
        <p className="expense-filters__summary" aria-live="polite">
          <span className="sr-only">{t("expenseFilters.activeFilters")}{" "}</span>
          {activeFilters.join(" · ")}
        </p>
      ) : null}

      <details className="filter-disclosure">
        <summary>{t("expenseFilters.disclosure")}</summary>
        <div className="filters filter-disclosure__content">
          <FormField label={t("expenseFilters.dateRange")}>
            {(id) => (
              <select id={id} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                <option value="all">{t("expenseFilters.dateOptions.all")}</option>
                <option value="last7">{t("expenseFilters.dateOptions.last7")}</option>
                <option value="last30">{t("expenseFilters.dateOptions.last30")}</option>
                <option value="thisMonth">{t("expenseFilters.dateOptions.thisMonth")}</option>
                <option value="custom">{t("expenseFilters.dateOptions.custom")}</option>
              </select>
            )}
          </FormField>

          {dateFilter === "custom" ? (
            <>
              <FormField label={t("expenseFilters.startDate")}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t("expenseFilters.endDate")}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                  />
                )}
              </FormField>
            </>
          ) : null}

          <FormField label={t("expenseFilters.category")}>
            {(id) => (
              <select id={id} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">{t("expenseFilters.allCategories")}</option>
                {DEFAULT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{categoryLabel(category)}</option>
                ))}
                <option value="Other">{t("categories.other")}</option>
              </select>
            )}
          </FormField>
        </div>
      </details>
    </Card>
  );
}
