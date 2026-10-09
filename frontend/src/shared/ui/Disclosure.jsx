import { useForcedOpen } from "./useForcedOpen";

// Real <button> (never <details>/<summary>): children must be inline text, no headings.
// While `forced` it stays focusable, is announced disabled via aria-disabled, the reason is
// exposed through aria-describedby, and click is a no-op. Omit `hint` to point `hintId` at an
// existing visible note instead of rendering the sr-only hint.
export function DisclosureButton({
  controls, open, forced = false, hint, hintId = `${controls}-hint`, onToggle, className = "", children,
}) {
  return (
    <>
      <button type="button" className={`button-ghost ui-disclosure__button ${className}`.trim()} aria-expanded={open}
        aria-controls={controls} aria-disabled={forced || undefined} aria-describedby={forced ? hintId : undefined}
        onClick={() => { if (!forced) onToggle(); }}>
        {children}
      </button>
      {forced && hint != null && <span id={hintId} className="sr-only">{hint}</span>}
    </>
  );
}

export function DisclosurePanel({ id, open, className = "", children }) {
  return <div id={id} hidden={!open} className={`ui-disclosure__panel ${className}`.trim()}>{children}</div>;
}

// Convenience composition (button + adjacent panel) for later slices.
export default function Disclosure({ id, label, hint, forced = false, className = "", children }) {
  const { open, toggle } = useForcedOpen(forced);
  return (
    <>
      <DisclosureButton controls={id} open={open} forced={forced} hint={hint} onToggle={toggle} className={className}>
        {label}
      </DisclosureButton>
      <DisclosurePanel id={id} open={open}>{children}</DisclosurePanel>
    </>
  );
}
