import { FORMAT_TAGS, normalizeLocale } from "./locale";

// Locale-aware presentation of money, percentages and dates. Every function is pure, takes
// the app locale ("en", "es", or a tag such as "en-US" that normalizeLocale accepts) and
// returns null when the input cannot be formatted exactly; callers keep their own
// "Amount needs review" / "unavailable" fallbacks. Currency is always USD and amounts are
// never converted or rounded here.
//
// Exactness: Intl.NumberFormat on a Number loses cents beyond 2^53, so the structure
// (symbol, separators, sign, spacing) is taken from formatToParts on a small probe value and
// the integer and fraction text is substituted with exact BigInt/string digits.

const MONEY_DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map();

function tagFor(locale) {
  return FORMAT_TAGS[normalizeLocale(locale)];
}

function numberFormat(locale, options) {
  const tag = tagFor(locale);
  const key = `n|${tag}|${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, new Intl.NumberFormat(tag, options));
  return formatterCache.get(key);
}

function dateFormat(locale, options) {
  const tag = tagFor(locale);
  const key = `d|${tag}|${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, new Intl.DateTimeFormat(tag, options));
  return formatterCache.get(key);
}

// Replaces the integer/group run and the fraction of a formatToParts result with exact text.
function substituteDigits(parts, integerText, fractionText) {
  let output = "";
  let integerWritten = false;
  for (const part of parts) {
    if (part.type === "integer" || part.type === "group") {
      if (!integerWritten) output += integerText;
      integerWritten = true;
    } else if (part.type === "fraction") {
      output += fractionText;
    } else {
      output += part.value;
    }
  }
  return output;
}

function groupedInteger(locale, whole) {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
}

/** Formats integer USD cents (bigint). `currency: false` omits the currency token. */
export function formatMoneyCents(cents, locale = "en", { currency = true } = {}) {
  if (typeof cents !== "bigint") return null;
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const options = currency
    ? {
      style: "currency",
      currency: "USD",
      currencyDisplay: normalizeLocale(locale) === "es" ? "code" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const parts = numberFormat(locale, options).formatToParts(negative ? -1 : 1);
  return substituteDigits(
    parts,
    groupedInteger(locale, absolute / 100n),
    String(absolute % 100n).padStart(2, "0"),
  );
}

/**
 * Formats a decimal string (or number) with at most two fraction digits, such as "1234.5" or
 * "-0.50". Negative zero renders without a sign. Returns null for anything else.
 */
export function formatMoneyDecimal(value, locale = "en", options) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = MONEY_DECIMAL.exec(String(value));
  if (!match) return null;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return formatMoneyCents(match[1] && cents !== 0n ? -cents : cents, locale, options);
}

function percentOptions(fractionDigits) {
  return { style: "percent", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };
}

/**
 * Formats exact tenths of a percent (bigint), for example 123n as "12.3%".
 * `grouping: false` keeps the integer digits ungrouped (used where output was never grouped).
 */
export function formatPercentTenths(tenths, locale = "en", { grouping = true } = {}) {
  if (typeof tenths !== "bigint") return null;
  const negative = tenths < 0n;
  const absolute = negative ? -tenths : tenths;
  const parts = numberFormat(locale, percentOptions(1)).formatToParts(negative ? -1 : 1);
  const whole = absolute / 10n;
  return substituteDigits(parts, grouping ? groupedInteger(locale, whole) : String(whole), String(absolute % 10n));
}

/** Formats a whole-number percent (integer Number or bigint), for example 45 as "45%". */
export function formatPercentWhole(value, locale = "en") {
  const whole = typeof value === "bigint" ? value : Number.isInteger(value) ? BigInt(value) : null;
  if (whole === null) return null;
  const negative = whole < 0n;
  const parts = numberFormat(locale, percentOptions(0)).formatToParts(negative ? -1 : 1);
  return substituteDigits(parts, groupedInteger(locale, negative ? -whole : whole), "");
}

// Strict YYYY-MM-DD to a UTC-midnight Date. setUTCFullYear avoids the Date.UTC year 0-99
// mapping and keeps the calendar day independent of the machine's timezone.
function calendarDateToUtc(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

// Years 1-999 print without padding in Intl; the app has always shown four digits.
function formatUtcDate(date, locale, options) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  return dateFormat(locale, { ...options, timeZone: "UTC" }).formatToParts(date)
    .map((part) => part.type === "year" ? year : part.value)
    .join("");
}

const CALENDAR_DATE_STYLES = {
  short: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  numeric: { year: "numeric", month: "2-digit", day: "2-digit" },
};

/** Formats a strict YYYY-MM-DD calendar date in the "short", "long" or "numeric" style. */
export function formatCalendarDate(value, locale = "en", style = "short") {
  const options = CALENDAR_DATE_STYLES[style];
  const match = typeof value === "string" ? CALENDAR_DATE.exec(value) : null;
  if (!options || !match) return null;
  const date = calendarDateToUtc(Number(match[1]), Number(match[2]), Number(match[3]));
  return date ? formatUtcDate(date, locale, options) : null;
}

/** Formats a calendar month such as March 2026 from a numeric year and 1-based month. */
export function formatMonthYear(year, month, locale = "en") {
  const date = calendarDateToUtc(year, month, 1);
  return date ? formatUtcDate(date, locale, { year: "numeric", month: "long" }) : null;
}

/** Formats an instant (Date, ISO string or epoch milliseconds) in the viewer's timezone. */
export function formatDateTime(value, locale = "en", { timeZone } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
