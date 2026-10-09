import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../../shared/localization/useLocale";
import { formatDate, formatMoney } from "../utils/formatPaychecks";

export default function PaycheckEvidence({ evidence = [], confirmed = false, disclosure = true, onRemove, disabled = false }) {
  const { t } = useTranslation("paychecks");
  const { locale } = useLocale();
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const confirmRef = useRef(null);
  const triggerRefs = useRef(new Map());

  useEffect(() => {
    if (pendingRemoval != null) confirmRef.current?.focus();
  }, [pendingRemoval]);

  if (!evidence.length) return <p className="muted">{t("evidence.none")}</p>;

  function timing(offset) {
    if (offset === 0) return t("evidence.onScheduleDate");
    return t(offset < 0 ? "evidence.daysBefore" : "evidence.daysAfter", { days: Math.abs(offset) });
  }

  const records = (
    <ul className="paycheck-evidence__list">
      {evidence.map((row) => (
        <li key={row.accountInflowId} className="paycheck-evidence__row">
          <div>
            <strong>{row.description}</strong>
            <span><time dateTime={row.postedDate}>{formatDate(row.postedDate, t, locale)}</time> · {row.source === "imported" ? t("evidence.imported") : t("evidence.manual")}</span>
            <span>{t("evidence.scheduleTiming", { date: formatDate(row.slotAnchor, t, locale), timing: timing(row.timingOffsetDays) })}</span>
            {confirmed && <span>{row.assignmentKind === "recorded_receipt" ? t("evidence.receivedPaycheck") : t("evidence.confirmationHistory")}</span>}
            {confirmed && row.editedSinceConfirmation && <span className="paycheck-evidence__edited">{t("evidence.edited")}</span>}
            {confirmed && row.assignmentKind === "recorded_receipt" && onRemove && (pendingRemoval === row.accountInflowId ? <div role="group" aria-label={t("evidence.removeLabel", { description: row.description })}>
              <p>{t("evidence.removePrompt")}</p>
              <div className="inline-actions">
                <button ref={confirmRef} type="button" disabled={disabled} onClick={() => onRemove(row.accountInflowId)}>{t("evidence.removeConfirm")}</button>
                <button type="button" className="button-ghost" disabled={disabled} onClick={() => { setPendingRemoval(null); requestAnimationFrame(() => triggerRefs.current.get(row.accountInflowId)?.focus()); }}>{t("evidence.removeCancel")}</button>
              </div>
            </div> : <button ref={(node) => { if (node) triggerRefs.current.set(row.accountInflowId, node); else triggerRefs.current.delete(row.accountInflowId); }} type="button" className="button-ghost" disabled={disabled} onClick={() => setPendingRemoval(row.accountInflowId)}>{t("evidence.removeTrigger")}</button>)}
          </div>
          <strong>{formatMoney(row.amount, t, locale)}</strong>
        </li>
      ))}
    </ul>
  );

  if (!disclosure) return (
    <section className="paycheck-evidence paycheck-evidence--inline">
      <h4>{confirmed ? t("evidence.linkedHeading", { total: evidence.length }) : t("evidence.reviewHeading", { total: evidence.length })}</h4>
      {records}
    </section>
  );

  return (
    <details className="paycheck-evidence">
      <summary>{confirmed ? t("evidence.linkedHeading", { total: evidence.length }) : t("evidence.reviewAll", { total: evidence.length })}</summary>
      {records}
    </details>
  );
}
