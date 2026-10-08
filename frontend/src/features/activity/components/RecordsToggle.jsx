// Disclosure button for a collapsed per-type Records list. While `forced` (a task, error, gate or
// recovery needs the list) it stays open: still focusable, announced as disabled, click is a no-op.
export default function RecordsToggle({ label, hint, bodyId, open, forced, onToggle }) {
  const hintId = `${bodyId}-hint`;
  return (
    <>
      <button type="button" className="button-ghost" aria-expanded={open} aria-controls={bodyId}
        aria-disabled={forced || undefined} aria-describedby={forced ? hintId : undefined}
        onClick={() => { if (!forced) onToggle(); }}>
        {label}
      </button>
      {forced && <span id={hintId} className="sr-only">{hint}</span>}
    </>
  );
}
