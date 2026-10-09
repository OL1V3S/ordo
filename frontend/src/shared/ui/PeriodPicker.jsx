import { useId, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthYear } from "../utils/monthYear";

const HALF_WINDOW = 12;

// Month picker: previous / native select / next / current. String-free: every label comes from
// the caller. The select is the only element labelled by `label`. Values are exact "YYYY-MM".
// The 25-month window recentres on the selected value, so every month stays reachable.
// An empty value (not producible by this UI) renders an empty option and disables stepping.
export default function PeriodPicker({
  value, onChange, disabled = false, label, previousLabel, nextLabel, currentLabel,
  currentValue, formatMonth, emptyLabel, className = "",
}) {
  const selectId = useId();
  const selectRef = useRef(null);
  const anchor = value || currentValue;
  const options = [];
  for (let offset = -HALF_WINDOW; offset <= HALF_WINDOW; offset += 1) {
    const month = shiftMonthYear(anchor, offset);
    if (month) options.push(month);
  }
  const stepDisabled = disabled || !value;

  return (
    <div className={`ui-period-picker ${className}`.trim()}>
      <label className="ui-period-picker__label" htmlFor={selectId}>{label}</label>
      <div className="ui-period-picker__controls">
        <button type="button" className="button-ghost icon-button" aria-label={previousLabel} disabled={stepDisabled}
          onClick={() => onChange(shiftMonthYear(value, -1))}>
          <ChevronLeft size={19} aria-hidden="true" />
        </button>
        <select id={selectId} ref={selectRef} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {value === "" && <option value="">{emptyLabel}</option>}
          {options.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select>
        <button type="button" className="button-ghost icon-button" aria-label={nextLabel} disabled={stepDisabled}
          onClick={() => onChange(shiftMonthYear(value, 1))}>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        <button type="button" className="button-ghost ui-period-picker__current" disabled={disabled || value === currentValue}
          onClick={() => { onChange(currentValue); selectRef.current?.focus(); }}>{currentLabel}</button>
      </div>
    </div>
  );
}
