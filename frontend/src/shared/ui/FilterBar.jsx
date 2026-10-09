import { useEffect, useRef } from "react";
import FormField from "./FormField";
import StatusStrip from "./StatusStrip";
import { DisclosureButton, DisclosurePanel } from "./Disclosure";
import { useForcedOpen } from "./useForcedOpen";

// Search + collapsible filter panel + removable chips + one polite status container.
// All text arrives through props; feature code owns the chip/status content.
export default function FilterBar({
  className = "", search, toggle, periods = null, fields = null, chips = [], showChips = false, chipsLabel,
  removeLabel, onRemove, clearLabel, onClear, status = [], statusClassName = "",
}) {
  const { open, toggle: toggleOpen } = useForcedOpen(toggle.forced);
  const searchRef = useRef(null);
  const chipsRef = useRef(null);
  const pendingFocus = useRef(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const button = target === "search" ? searchRef.current
      : chipsRef.current?.querySelector(`[data-chip-remove="${target}"]`);
    (button ?? searchRef.current)?.focus();
  });

  function removeChip(key) {
    const index = chips.findIndex((chip) => chip.key === key);
    pendingFocus.current = (chips[index + 1] ?? chips[index - 1])?.key ?? "search";
    onRemove(key);
  }

  return (
    <div className={`ui-filter-bar ${className}`.trim()}>
      <div className="filters ui-filter-bar__fields">
        <FormField label={search.label} className="ui-filter-bar__search">
          {(id) => (
            <input id={id} ref={searchRef} type="search" value={search.value} maxLength={search.maxLength}
              placeholder={search.placeholder} aria-invalid={search.invalid || undefined}
              onChange={(event) => search.onChange(event.target.value)} />
          )}
        </FormField>
        <DisclosureButton controls={toggle.panelId} hintId={toggle.hintId} open={open} forced={toggle.forced}
          hint={toggle.hint} onToggle={toggleOpen} className={`ui-filter-bar__toggle ${toggle.className ?? ""}`.trim()}>
          {toggle.label}
        </DisclosureButton>
      </div>
      <DisclosurePanel id={toggle.panelId} open={open} className="ui-filter-bar__panel">
        {periods && <div role="group" aria-label={periods.label} className="ui-filter-bar__periods">
          <span className="ui-filter-bar__periods-label" aria-hidden="true">{periods.label}</span>
          {periods.options.map((option) => (
            <button key={option.value} type="button" className="button-ghost ui-filter-bar__period"
              aria-pressed={periods.value === option.value} onClick={() => periods.onChange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>}
        <div className="filters ui-filter-bar__fields">{fields}</div>
      </DisclosurePanel>
      {showChips && <div className="ui-filter-bar__chips" ref={chipsRef} role="group" aria-label={chipsLabel}>
        {chips.map((chip) => (
          <span key={chip.key} className="ui-filter-bar__chip">
            <span>{chip.label}</span>
            <button type="button" data-chip-remove={chip.key} className="ui-filter-bar__chip-remove"
              aria-label={removeLabel(chip)} onClick={() => removeChip(chip.key)}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        ))}
        <button type="button" className="button-ghost" onClick={() => { onClear(); searchRef.current?.focus(); }}>
          {clearLabel}
        </button>
      </div>}
      <StatusStrip className={`ui-filter-bar__status ${statusClassName}`.trim()} messages={status} />
    </div>
  );
}
