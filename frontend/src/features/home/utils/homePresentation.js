import { parseExactMoney } from "../../expenses/utils/exactMoney";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;
const PROFILE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CADENCES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

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

function addCalendarDays(date, days) {
  if (!isDateOnly(date)) return null;
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  const iso = result.toISOString();
  return /^\d{4}-/.test(iso) ? iso.slice(0, 10) : null;
}

function parseCanonicalAmount(value) {
  if (typeof value !== "string" || !DECIMAL_AMOUNT.test(value)) return null;
  const parsed = parseExactMoney(value);
  return parsed?.value === value ? parsed : null;
}

function isUpcomingAmount(value) {
  if (!value || typeof value !== "object") return false;
  if (value.mode === "fixed") {
    return parseCanonicalAmount(value.fixedAmount) !== null
      && value.minimumAmount === null && value.maximumAmount === null;
  }
  if (value.mode === "range") {
    const minimum = parseCanonicalAmount(value.minimumAmount);
    const maximum = parseCanonicalAmount(value.maximumAmount);
    return value.fixedAmount === null && minimum !== null && maximum !== null
      && minimum.cents < maximum.cents;
  }
  return false;
}

function isUpcomingItem(value, horizon) {
  if (!value || typeof value !== "object"
      || value.kind !== "paycheck_projection"
      || typeof value.paycheckProfileId !== "string" || !PROFILE_ID.test(value.paycheckProfileId)
      || typeof value.displayName !== "string" || value.displayName.trim().length === 0
      || !CADENCES.has(value.cadence)
      || !isDateOnly(value.anchorDate)
      || !isDateOnly(value.earliestExpectedDate)
      || !isDateOnly(value.latestExpectedDate)
      || value.earliestExpectedDate > value.anchorDate
      || value.anchorDate > value.latestExpectedDate
      || value.latestExpectedDate < horizon.from
      || value.earliestExpectedDate > horizon.through
      || !isUpcomingAmount(value.amount)) return false;
  return true;
}

export function isHomeUpcomingSection(value, upcomingEvaluatedOn) {
  if (!value || typeof value !== "object"
      || !value.horizon || !isDateOnly(value.horizon.from) || !isDateOnly(value.horizon.through)
      || value.horizon.from !== upcomingEvaluatedOn
      || value.horizon.through !== addCalendarDays(upcomingEvaluatedOn, 13)
      || !isAvailability(value, "items")) return false;
  if (value.availability.state === "unavailable") return true;
  return value.items.length <= 2 && value.items.every((item) => isUpcomingItem(item, value.horizon));
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

export function formatHomeProjectionAmount(value, locale) {
  const parsed = parseCanonicalAmount(value);
  if (!parsed) return null;

  const dollars = parsed.cents / 100n;
  const fraction = String(parsed.cents % 100n).padStart(2, "0");
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(dollars);
  return parts.map((part) => part.type === "fraction" ? fraction : part.value).join("");
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
