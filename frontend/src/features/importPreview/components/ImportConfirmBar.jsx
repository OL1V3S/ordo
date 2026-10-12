import { Trans, useTranslation } from "react-i18next";
import { formatTotal } from "../utils/importReview";
import { useLocale } from "../../../shared/localization/useLocale";

// The single confirm action plus exact, separate totals for expenses and incoming deposits.
// Totals are static text; only the guidance line is a live region. No net or balance wording.
export default function ImportConfirmBar({
  selectedItemsLabel,
  totals,
  guidance,
  disabled,
  confirming,
  confirmLabel,
  onConfirm,
}) {
  const { t } = useTranslation("importPreview");
  const { locale } = useLocale();
  return (
    <div className="import-confirm-bar" role="group" aria-label={t("bar.label")}>
      <div className="import-confirm-bar__summary">
        <p className="import-confirmation-actions__selection">
          <Trans t={t} i18nKey="results.selected" values={{ items: selectedItemsLabel }} components={{ strong: <strong /> }} />
        </p>
        <p className="import-confirm-bar__total">
          {t("bar.expensesToSave", { count: totals.expenseCount, total: formatTotal(t, totals.expenseCents, locale) })}
        </p>
        <p className="import-confirm-bar__total">
          {t("bar.depositsToSave", { count: totals.depositCount, total: formatTotal(t, totals.depositCents, locale) })}
        </p>
        <p id="import-confirmation-guidance" className="muted import-confirm-bar__guidance" role="status" aria-live="polite">
          {guidance}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-busy={confirming}
        aria-describedby="import-confirmation-guidance"
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
