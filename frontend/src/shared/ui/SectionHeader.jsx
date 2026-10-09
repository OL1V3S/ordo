// Heading with at most one optional action node.
export default function SectionHeader({ level = 2, id, title, headingRef, focusable = false, action = null, className = "" }) {
  const Heading = `h${level}`;
  return (
    <div className={`ui-section-header ${className}`.trim()}>
      <Heading id={id} ref={headingRef} tabIndex={focusable ? -1 : undefined}>{title}</Heading>
      {action}
    </div>
  );
}
