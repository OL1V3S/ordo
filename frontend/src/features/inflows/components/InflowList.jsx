import { useTranslation } from "react-i18next";
import { formatInflowDate, formatInflowMoney } from "../utils/inflowForm";

export default function InflowList({
  inflows,
  totalCount,
  filteredCount,
  showAll,
  onShowAll,
  onEdit,
  onDelete,
  disabled = false,
  readUnavailable = false,
  taskRecordId = null,
}) {
  const { t } = useTranslation("activity");
  if (!inflows || inflows.length === 0) {
    const hasRecordedInflows = typeof totalCount === "number" && totalCount > 0;
    return (
      <p className="empty-state inflow-list__empty">
        {hasRecordedInflows ? t("cashIn.list.noMatches") : t("cashIn.list.none")}
      </p>
    );
  }

  const actionsDisabled = disabled || readUnavailable;

  return (
    <div className="inflow-list">
      <div className="table-wrapper inflow-list__table-wrapper" role="region" aria-label={t("cashIn.list.tableLabel")} tabIndex="0">
        <table className="data-table inflow-table">
          <caption className="sr-only">{t("cashIn.list.caption")}</caption>
          <thead>
            <tr>
              <th>{t("cashIn.list.columns.description")}</th>
              <th>{t("cashIn.list.columns.amount")}</th>
              <th>{t("cashIn.list.columns.date")}</th>
              <th>{t("cashIn.list.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {inflows.map((inflow) => {
              const formattedDate = formatInflowDate(inflow.date, t("cashIn.list.unknownDate"));
              const labelValues = { description: inflow.description, date: formattedDate, id: inflow.id };
              const isTaskRecord = taskRecordId === inflow.id;
              return (
                <tr key={inflow.id} className={`inflow-row${isTaskRecord ? " inflow-row--task" : ""}`} aria-current={isTaskRecord ? "true" : undefined}>
                  <td className="inflow-cell inflow-cell--description" data-label={t("cashIn.list.columns.description")}>{inflow.description}</td>
                  <td className="inflow-cell inflow-cell--amount" data-label={t("cashIn.list.columns.amount")}>{formatInflowMoney(inflow.amount, t("cashIn.list.amountReview"))}</td>
                  <td className="inflow-cell inflow-cell--date" data-label={t("cashIn.list.columns.date")}>{formattedDate}</td>
                  <td className="inflow-cell inflow-cell--actions" data-label={t("cashIn.list.columns.actions")}>
                    <div className="inline-actions inflow-row__actions">
                      <button
                        type="button"
                        className="button-ghost"
                        disabled={actionsDisabled}
                        aria-label={t("cashIn.list.editLabel", labelValues)}
                        onClick={(event) => onEdit(inflow, event.currentTarget)}
                      >
                        {t("cashIn.list.edit")}
                      </button>
                      <button
                        type="button"
                        className="button-ghost"
                        disabled={actionsDisabled}
                        aria-label={t("cashIn.list.deleteLabel", labelValues)}
                        onClick={(event) => onDelete(inflow, event.currentTarget)}
                      >
                        {t("cashIn.list.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!showAll && filteredCount > 10 && (
        <button type="button" className="button-ghost inflow-list__show-all" onClick={onShowAll} disabled={disabled}>
          {t("cashIn.list.showAll")}
        </button>
      )}
    </div>
  );
}
