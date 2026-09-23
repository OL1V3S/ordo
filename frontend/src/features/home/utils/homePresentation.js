import { parseExactMoney } from "../../expenses/utils/exactMoney";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;

function isDateOnly(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isAvailability(value, itemsKey) {
  if (!value || typeof value !== "object" || !value.availability) return false;
  const { state, reasonCode } = value.availability;
  if (state === "available") return reasonCode === null && Array.isArray(value[itemsKey]);
  return state === "unavailable" && reasonCode === "source_unavailable" && value[itemsKey] === null;
}

function isActivityItem(value) {
  if (!value || typeof value !== "object"
      || !["expense", "account_inflow"].includes(value.kind)
      || !Number.isInteger(value.recordId) || value.recordId <= 0
      || !isDateOnly(value.date)
      || typeof value.amount !== "string" || !DECIMAL_AMOUNT.test(value.amount)
      || !parseExactMoney(value.amount)
      || typeof value.description !== "string"
      || !(value.category === null || typeof value.category === "string")) return false;

  if (value.kind === "expense") return value.paycheck === null;
  if (value.category !== null) return false;
  return value.paycheck === null || (typeof value.paycheck === "object"
    && typeof value.paycheck.profileId === "string"
    && ["confirmation_evidence", "recorded_receipt"].includes(value.paycheck.relation));
}

export function isHomeResponse(value) {
  if (!value || typeof value !== "object"
      || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))
      || value.currencyCode !== "USD"
      || !value.evaluations || !isDateOnly(value.evaluations.activityThroughDate)
      || !isDateOnly(value.evaluations.upcomingEvaluatedOn)
      || !isAvailability(value.recentActivity, "items")) return false;

  return value.recentActivity.availability.state === "unavailable"
    || value.recentActivity.items.every(isActivityItem);
}

export function formatHomeDate(date, locale) {
  if (!isDateOnly(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatHomeAmount(value, kind, locale) {
  const parsed = typeof value === "string" && DECIMAL_AMOUNT.test(value)
    ? parseExactMoney(value)
    : null;
  if (!parsed || !["expense", "account_inflow"].includes(kind)) return null;

  const dollars = parsed.cents / 100n;
  const fraction = String(parsed.cents % 100n).padStart(2, "0");
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(dollars);
  const formatted = parts.map((part) => part.type === "fraction" ? fraction : part.value).join("");
  return `${kind === "expense" ? "−" : "+"}${formatted}`;
}
