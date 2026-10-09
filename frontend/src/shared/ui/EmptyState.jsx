// `inline` is a muted paragraph; `block` is a titled box with an optional action. No role (static text).
export default function EmptyState({ variant = "inline", title, children, action = null, className = "" }) {
  if (variant === "block") {
    return (
      <div className={`empty-state ui-empty-state ${className}`.trim()}>
        {title && <p className="ui-empty-state__title">{title}</p>}
        {children}
        {action}
      </div>
    );
  }
  return <p className={`muted ui-empty-state ${className}`.trim()}>{children}</p>;
}
