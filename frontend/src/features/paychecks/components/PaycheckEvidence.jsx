import { useEffect, useRef, useState } from "react";
import { formatDate, formatMoney } from "../utils/formatPaychecks";

export default function PaycheckEvidence({ evidence = [], confirmed = false, disclosure = true, onRemove, disabled = false }) {
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const confirmRef = useRef(null);
  const triggerRefs = useRef(new Map());

  useEffect(() => {
    if (pendingRemoval != null) confirmRef.current?.focus();
  }, [pendingRemoval]);

  if (!evidence.length) return <p className="muted">No linked deposit evidence. This is your saved expectation.</p>;

  const records = (
    <ul className="paycheck-evidence__list">
      {evidence.map((row) => (
        <li key={row.accountInflowId} className="paycheck-evidence__row">
          <div>
            <strong>{row.description}</strong>
            <span><time dateTime={row.postedDate}>{formatDate(row.postedDate)}</time> · {row.source === "imported" ? "Imported deposit" : "Manual deposit"}</span>
            <span>Schedule date {formatDate(row.slotAnchor)} · {row.timingOffsetDays === 0 ? "On schedule date" : `${Math.abs(row.timingOffsetDays)} day(s) ${row.timingOffsetDays < 0 ? "before" : "after"}`}</span>
            {confirmed && <span>{row.assignmentKind === "recorded_receipt" ? "Received paycheck" : "Confirmation history"}</span>}
            {confirmed && row.editedSinceConfirmation && <span className="paycheck-evidence__edited">Edited since this deposit was linked. The saved expectation is unchanged.</span>}
            {confirmed && row.assignmentKind === "recorded_receipt" && onRemove && (pendingRemoval === row.accountInflowId ? <div role="group" aria-label={`Remove paycheck link for ${row.description}`}>
              <p>Remove this paycheck link? The cash-in record will remain in Activity.</p>
              <div className="inline-actions">
                <button ref={confirmRef} type="button" disabled={disabled} onClick={() => onRemove(row.accountInflowId)}>Confirm removal</button>
                <button type="button" className="button-ghost" disabled={disabled} onClick={() => { setPendingRemoval(null); requestAnimationFrame(() => triggerRefs.current.get(row.accountInflowId)?.focus()); }}>Cancel</button>
              </div>
            </div> : <button ref={(node) => { if (node) triggerRefs.current.set(row.accountInflowId, node); else triggerRefs.current.delete(row.accountInflowId); }} type="button" className="button-ghost" disabled={disabled} onClick={() => setPendingRemoval(row.accountInflowId)}>Remove paycheck link</button>)}
          </div>
          <strong>{formatMoney(row.amount)}</strong>
        </li>
      ))}
    </ul>
  );

  if (!disclosure) return (
    <section className="paycheck-evidence paycheck-evidence--inline">
      <h4>{confirmed ? "Linked paycheck deposits" : "Deposits to review"} ({evidence.length})</h4>
      {records}
    </section>
  );

  return (
    <details className="paycheck-evidence">
      <summary>{confirmed ? "Linked paycheck deposits" : "Review every deposit"} ({evidence.length})</summary>
      {records}
    </details>
  );
}
