import { formatCalendarDate, formatMoneyCents } from "../../../shared/localization/format";
import { parseExactMoney } from "../../expenses/utils/exactMoney";

// Home's recent-activity validator rejects a legacy zero or negative expense amount for the
// whole response. The timeline instead validates structure strictly and degrades only the
// amount of the affected row, so its own validator and formatter live here.

export const ACTIVITY_TIMELINE_PAGE_SIZE = 25;

const MAX_PAGE_LIMIT = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STORED_AMOUNT = /^-?\d+\.\d{2}$/;
const CANONICAL_POSITIVE_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;
const KINDS = new Set(["expense", "account_inflow"]);
const RELATIONS = new Set(["confirmation_evidence", "recorded_receipt"]);

function isDateOnly(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isTimelineItem(value) {
  if (!value || typeof value !== "object"
      || !KINDS.has(value.kind)
      || !Number.isInteger(value.recordId) || value.recordId <= 0
      || !isDateOnly(value.date)
      || typeof value.amount !== "string" || !STORED_AMOUNT.test(value.amount)
      || typeof value.description !== "string") return false;

  if (value.kind === "expense") return typeof value.category === "string" && value.paycheck === null;
  if (value.category !== null) return false;
  return value.paycheck === null || (typeof value.paycheck === "object"
    && typeof value.paycheck.profileId === "string" && value.paycheck.profileId !== ""
    && RELATIONS.has(value.paycheck.relation));
}

export function isActivityTimelinePage(value) {
  if (!value || typeof value !== "object"
      || value.currencyCode !== "USD"
      || !Array.isArray(value.items)
      || !value.page || typeof value.page !== "object") return false;

  const { limit, hasMore, nextCursor } = value.page;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT
      || typeof hasMore !== "boolean"
      || value.items.length > limit) return false;
  if (hasMore ? typeof nextCursor !== "string" || nextCursor === "" : nextCursor !== null) return false;
  return value.items.every(isTimelineItem);
}

export function timelineItemKey(item) {
  return `${item.kind}:${item.recordId}`;
}

export function formatTimelineDate(date, locale = "en") {
  if (!isDateOnly(date)) return null;
  return formatCalendarDate(date, locale, "short");
}

// Returns a signed display amount for a canonical positive amount, or null when the stored
// value is zero, negative, or otherwise not a positive two-decimal amount. Callers show
// "Amount needs review" and the stored value unaltered in that case; nothing is repaired.
export function formatTimelineAmount(value, kind, locale = "en") {
  if (typeof value !== "string" || !CANONICAL_POSITIVE_AMOUNT.test(value) || !KINDS.has(kind)) return null;
  const parsed = parseExactMoney(value);
  if (!parsed || parsed.value !== value) return null;

  return `${kind === "expense" ? "−" : "+"}${formatMoneyCents(parsed.cents, locale)}`;
}
