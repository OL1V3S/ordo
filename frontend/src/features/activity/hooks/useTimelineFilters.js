import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_TIMELINE_FILTER,
  TIMELINE_SEARCH_DEBOUNCE_MS,
  isTimelineFilterActive,
  normalizeTimelineFilter,
  periodRange,
  timelineFilterKey,
  validateTimelineFilter,
} from "../utils/timelineFilter";

// Filter controls state. `draft` is what the controls show; `applied` is what the timeline reads
// with. Search is debounced; kind and dates apply at once. An invalid draft never replaces the
// applied filter, so no request is made for it. Filters reset on page load (no persistence).
export function useTimelineFilters(delay = TIMELINE_SEARCH_DEBOUNCE_MS) {
  const [draft, setDraft] = useState(EMPTY_TIMELINE_FILTER);
  const [applied, setApplied] = useState(EMPTY_TIMELINE_FILTER);
  const [period, setPeriodState] = useState("all");
  const [presetRange, setPresetRange] = useState(null);
  const error = useMemo(() => validateTimelineFilter(draft), [draft]);
  const draftKey = timelineFilterKey(draft);
  const appliedKey = timelineFilterKey(applied);

  useEffect(() => {
    if (error || draftKey === appliedKey) return undefined;
    const next = normalizeTimelineFilter(draft);
    const searchOnly = next.kind === applied.kind && next.from === applied.from && next.to === applied.to;
    const timer = setTimeout(() => setApplied(next), searchOnly ? delay : 0);
    return () => clearTimeout(timer);
  }, [applied, appliedKey, delay, draft, draftKey, error]);

  const setField = useCallback((name, value) => {
    if (name === "from" || name === "to") setPeriodState("custom");
    setDraft((current) => ({ ...current, [name]: value }));
  }, []);
  // Period is presentation state only: it is not part of the filter, its key, or the request.
  const setPeriod = useCallback((next) => {
    setPeriodState(next);
    const range = periodRange(next, new Date());
    if (!range) return;
    setPresetRange(range);
    setDraft((current) => ({ ...current, ...range }));
  }, []);
  // Removes one applied filter at once. The next applied value comes from `applied`, so a
  // pending debounced search or an invalid draft can neither leak in nor block the removal.
  const removeField = useCallback((name) => {
    const fields = name === "period" ? ["from", "to"] : [name];
    const clearFields = (filter) => ({ ...filter, ...Object.fromEntries(fields.map((field) => [field, ""])) });
    const next = clearFields(applied);
    if (fields.includes("from") || fields.includes("to")) {
      setPeriodState(name === "period" || !(name === "from" ? next.to : next.from) ? "all" : "custom");
    }
    setDraft(clearFields);
    if (!validateTimelineFilter(next)) setApplied(normalizeTimelineFilter(next));
  }, [applied]);
  const clear = useCallback(() => {
    setDraft(EMPTY_TIMELINE_FILTER);
    setApplied(EMPTY_TIMELINE_FILTER);
    setPeriodState("all");
    setPresetRange(null);
  }, []);

  return {
    draft, applied, error, period, presetRange, active: isTimelineFilterActive(draft) || isTimelineFilterActive(applied),
    setField, setPeriod, removeField, clear,
  };
}
