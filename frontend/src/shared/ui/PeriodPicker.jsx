import { useId, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthYear } from "../utils/monthYear";
import { neighbourMonths } from "./periodNeighbours";

const HALF_WINDOW = 12;

// Month picker: previous / native select / next / current. String-free: every label comes from
// the caller. The select is the only element labelled by `label`. Values are exact "YYYY-MM".
// The 25-month window recentres on the selected value, so every month stays reachable.
// An empty value (not producible by this UI) renders an empty option and disables stepping.
// Optional `months` (array of "YYYY-MM"): options are exactly that list in the caller's order
// (Insights passes newest first; the default window is ascending), with no 25-month window.
// Previous/next then jump to the nearest listed month below/above `value`, so they skip months
// that are not listed (callers should label them accordingly) and are disabled when none exists.
// A non-empty `value` missing from `months` is shown as an extra leading option so the select
// stays truthful; stepping still works relative to it. Current is disabled when `currentValue`
// is not listed. Without `months` behaviour is unchanged.
export default function PeriodPicker({
  value, onChange, disabled = false, label, previousLabel, nextLabel, currentLabel,
  currentValue, formatMonth, emptyLabel, className = "", months,
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
  let earlier;
  let later;
  if (months) {
    options.length = 0;
    if (value && !months.includes(value)) options.push(value);
    options.push(...months);
    ({ earlier, later } = neighbourMonths(months, value));
  }
  const currentDisabled = disabled || value === currentValue || Boolean(months && !months.includes(currentValue));

  return (
    <div className={`ui-period-picker ${className}`.trim()}>
      <label className="ui-period-picker__label" htmlFor={selectId}>{label}</label>
      <div className="ui-period-picker__controls">
        <button type="button" className="button-ghost icon-button" aria-label={previousLabel} disabled={stepDisabled || (months && earlier === undefined)}
          onClick={() => onChange(months ? earlier : shiftMonthYear(value, -1))}>
          <ChevronLeft size={19} aria-hidden="true" />
        </button>
        <select id={selectId} ref={selectRef} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {value === "" && <option value="">{emptyLabel}</option>}
          {options.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
        </select>
        <button type="button" className="button-ghost icon-button" aria-label={nextLabel} disabled={stepDisabled || (months && later === undefined)}
          onClick={() => onChange(months ? later : shiftMonthYear(value, 1))}>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
        <button type="button" className="button-ghost ui-period-picker__current" disabled={currentDisabled}
          onClick={() => { onChange(currentValue); selectRef.current?.focus(); }}>{currentLabel}</button>
      </div>
    </div>
  );
}
