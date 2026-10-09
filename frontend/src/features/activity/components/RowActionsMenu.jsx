import { useTranslation } from "react-i18next";
import UiRowActionsMenu from "../../../shared/ui/RowActionsMenu";

// Activity binding of the shared kit menu: supplies the activity strings and delete styling.
export default function RowActionsMenu({ kind, labelValues, state, onEdit, onDelete }) {
  const { t } = useTranslation("activity");
  const expense = kind === "expense";
  return (
    <UiRowActionsMenu
      triggerLabel={t(expense ? "timeline.actions.moreExpense" : "timeline.actions.moreCashIn", labelValues)}
      editLabel={t(expense ? "timeline.actions.editExpense" : "timeline.actions.editCashIn", labelValues)}
      editText={t("timeline.actions.edit")}
      deleteLabel={t(expense ? "timeline.actions.deleteExpense" : "timeline.actions.deleteCashIn", labelValues)}
      deleteText={t("timeline.actions.delete")}
      canEdit={state.canEdit}
      canDelete={state.canDelete}
      deleteClassName={expense ? "button-danger" : "button-ghost"}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}
