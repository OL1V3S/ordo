import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

// Non-modal disclosure popover (same pattern as AccountMenu): no ARIA menu role and no focus
// trap. Escape, an outside pointerdown, or focus leaving the wrapper closes it. The panel is
// always rendered (hidden) so aria-controls never dangles. String-free: labels come from props.
export default function RowActionsMenu({
  triggerLabel, editLabel, editText, deleteLabel, deleteText,
  canEdit, canDelete, deleteClassName = "button-danger", onEdit, onDelete, items,
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  // Generic mode: `items` = [{ key, label, text, disabled, className, onSelect }] replaces Edit/Delete.
  const disabled = items ? items.every((item) => item.disabled) : !canEdit && !canDelete;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // A menu whose actions all become unavailable closes; focus that was inside it moves to the
  // page heading because a disabled trigger cannot hold it.
  useEffect(() => {
    if (!open || !disabled) return;
    setOpen(false);
    const active = document.activeElement;
    if (wrapperRef.current?.contains(active) && active !== document.body) document.querySelector("h1")?.focus();
  }, [open, disabled]);

  function handleBlur(event) {
    const next = event.relatedTarget;
    if (next && !wrapperRef.current?.contains(next)) setOpen(false);
  }

  function choose(handler) {
    setOpen(false);
    triggerRef.current?.focus();
    handler(triggerRef.current);
  }

  return (
    <div className="row-actions-menu ui-row-actions-menu" ref={wrapperRef} onBlur={handleBlur}>
      <button type="button" ref={triggerRef} className="button-ghost icon-button row-actions-menu__trigger" disabled={disabled}
        aria-expanded={open && !disabled} aria-controls={panelId} aria-label={triggerLabel} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={19} aria-hidden="true" />
      </button>
      <div id={panelId} className="row-actions-menu__panel" role="group" aria-label={triggerLabel} hidden={!open || disabled}>
        {items ? items.map((item) => (
          <button key={item.key} type="button" className={item.className} disabled={item.disabled} aria-label={item.label}
            onClick={() => choose(item.onSelect)}>{item.text}</button>
        )) : (
          <>
            <button type="button" disabled={!canEdit} aria-label={editLabel} onClick={() => choose(onEdit)}>{editText}</button>
            <button type="button" className={deleteClassName} disabled={!canDelete} aria-label={deleteLabel}
              onClick={() => choose(onDelete)}>{deleteText}</button>
          </>
        )}
      </div>
    </div>
  );
}
