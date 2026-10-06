import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_TIMELINE_FILTER,
  TIMELINE_SEARCH_DEBOUNCE_MS,
  isTimelineFilterActive,
  normalizeTimelineFilter,
  timelineFilterKey,
  validateTimelineFilter,
} from "../utils/timelineFilter";

// Filter controls state. `draft` is what the controls show; `applied` is what the timeline reads
// with. Search is debounced; kind and dates apply at once. An invalid draft never replaces the
// applied filter, so no request is made for it. Filters reset on page load (no persistence).
export function useTimelineFilters(delay = TIMELINE_SEARCH_DEBOUNCE_MS) {
  const [draft, setDraft] = useState(EMPTY_TIMELINE_FILTER);
  const [applied, setApplied] = useState(EMPTY_TIMELINE_FILTER);
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

  const setField = useCallback((name, value) => setDraft((current) => ({ ...current, [name]: value })), []);
  const clear = useCallback(() => {
    setDraft(EMPTY_TIMELINE_FILTER);
    setApplied(EMPTY_TIMELINE_FILTER);
  }, []);

  return { draft, applied, error, active: isTimelineFilterActive(draft) || isTimelineFilterActive(applied), setField, clear };
}
