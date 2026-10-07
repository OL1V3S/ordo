// Timeline filters are applied by the server so every page of history stays reachable.
// The server's 400 detail is never shown, so the same limits are enforced here first.

export const MAX_TIMELINE_SEARCH_LENGTH = 100;
export const TIMELINE_SEARCH_DEBOUNCE_MS = 300;
export const EMPTY_TIMELINE_FILTER = Object.freeze({ q: "", kind: "", from: "", to: "" });

const KINDS = new Set(["", "expense", "account_inflow"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function normalizeTimelineFilter(filter) {
  return {
    q: typeof filter?.q === "string" ? filter.q.trim() : "",
    kind: typeof filter?.kind === "string" ? filter.kind : "",
    from: typeof filter?.from === "string" ? filter.from : "",
    to: typeof filter?.to === "string" ? filter.to : "",
  };
}

export function timelineFilterKey(filter) {
  const { q, kind, from, to } = normalizeTimelineFilter(filter);
  return JSON.stringify([q, kind, from, to]);
}

export function isTimelineFilterActive(filter) {
  const { q, kind, from, to } = normalizeTimelineFilter(filter);
  return Boolean(q || kind || from || to);
}

// Returns an error code or null. A date left empty is simply not a bound.
export function validateTimelineFilter(filter) {
  const { q, kind, from, to } = normalizeTimelineFilter(filter);
  if (q.length > MAX_TIMELINE_SEARCH_LENGTH) return "search";
  if (!KINDS.has(kind)) return "kind";
  if ((from && !isDateOnly(from)) || (to && !isDateOnly(to))) return "date";
  if (from && to && from > to) return "range";
  return null;
}

// Request parameters for the set filters only, so an unfiltered read is identical to before.
export function timelineFilterParams(filter) {
  return Object.fromEntries(Object.entries(normalizeTimelineFilter(filter)).filter(([, value]) => value));
}
