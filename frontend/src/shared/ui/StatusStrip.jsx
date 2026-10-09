// One always-mounted live container per region. No role (StatusMessage keeps role=alert/status),
// and nothing (not even whitespace) is rendered while idle.
export default function StatusStrip({ messages = [], limit = 1, politeness = "polite", action = null, className = "" }) {
  return (
    <div className={`ui-status-strip ${className}`.trim()} aria-live={politeness}>
      {messages.slice(0, limit).map(({ id, tone, text, visuallyHidden }) => (
        <p key={id} className={visuallyHidden ? "sr-only" : `status-message status-message--${tone ?? "info"}`}>{text}</p>
      ))}
      {action && <button type="button" className="button-ghost ui-status-strip__action" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
