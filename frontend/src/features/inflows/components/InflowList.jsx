import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import RowActionsMenu from "../../activity/components/RowActionsMenu";
import { formatInflowDate, formatInflowMoney } from "../utils/inflowForm";

// Read-only table of every cash-in record (recovery, check-your-records and timeline-failure
// states). `rowActions` (the timeline adapter) adds the "…" menu only in the fallback.
export default function InflowList({ inflows, rowActions = null }) {
  const { t } = useTranslation("activity");
  const { locale } = useLocale();
  if (!inflows || inflows.length === 0) {
    return <p className="empty-state inflow-list__empty">{t("cashIn.list.none")}</p>;
  }

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
              {rowActions && <th>{t("cashIn.list.columns.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {inflows.map((inflow) => {
              const formattedDate = formatInflowDate(inflow.date, t("cashIn.list.unknownDate"), locale);
              const item = { kind: "account_inflow", recordId: inflow.id };
              return (
                <tr key={inflow.id} className="inflow-row">
                  <td className="inflow-cell inflow-cell--description" data-label={t("cashIn.list.columns.description")}>{inflow.description}</td>
                  <td className="inflow-cell inflow-cell--amount" data-label={t("cashIn.list.columns.amount")}>{formatInflowMoney(inflow.amount, t("cashIn.list.amountReview"), locale)}</td>
                  <td className="inflow-cell inflow-cell--date" data-label={t("cashIn.list.columns.date")}>{formattedDate}</td>
                  {rowActions && <td className="inflow-cell inflow-cell--actions" data-label={t("cashIn.list.columns.actions")}>
                    <RowActionsMenu kind="account_inflow" labelValues={{ description: inflow.description, date: formattedDate, id: inflow.id }}
                      state={rowActions.getState(item)} onEdit={(opener) => rowActions.onEdit(item, opener)} onDelete={(opener) => rowActions.onDelete(item, opener)} />
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
