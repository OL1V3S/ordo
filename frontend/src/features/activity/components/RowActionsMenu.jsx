import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

// Non-modal disclosure popover (same pattern as AccountMenu): no ARIA menu role and no focus
// trap. Escape, an outside pointerdown, or focus leaving the wrapper closes it. The panel is
// always rendered (hidden) so aria-controls never dangles.
export default function RowActionsMenu({ kind, labelValues, state, onEdit, onDelete }) {
  const { t } = useTranslation("activity");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const expense = kind === "expense";
  const disabled = !state.canEdit && !state.canDelete;
  const triggerLabel = t(expense ? "timeline.actions.moreExpense" : "timeline.actions.moreCashIn", labelValues);

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
    <div className="row-actions-menu" ref={wrapperRef} onBlur={handleBlur}>
      <button type="button" ref={triggerRef} className="button-ghost icon-button row-actions-menu__trigger" disabled={disabled}
        aria-expanded={open && !disabled} aria-controls={panelId} aria-label={triggerLabel} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={19} aria-hidden="true" />
      </button>
      <div id={panelId} className="row-actions-menu__panel" role="group" aria-label={triggerLabel} hidden={!open || disabled}>
        <button type="button" disabled={!state.canEdit}
          aria-label={t(expense ? "timeline.actions.editExpense" : "timeline.actions.editCashIn", labelValues)}
          onClick={() => choose(onEdit)}>{t("timeline.actions.edit")}</button>
        <button type="button" className={expense ? "button-danger" : "button-ghost"} disabled={!state.canDelete}
          aria-label={t(expense ? "timeline.actions.deleteExpense" : "timeline.actions.deleteCashIn", labelValues)}
          onClick={() => choose(onDelete)}>{t("timeline.actions.delete")}</button>
      </div>
    </div>
  );
}
