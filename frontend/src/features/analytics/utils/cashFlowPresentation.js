import { formatMoneyCents, formatPercentTenths } from "../../../shared/localization/format";
import i18n from "../../../shared/localization/i18n";

// Callers that render localized copy pass their own `t`. Callers that have not adopted
// localization keep the English wording, read from the same English catalog.
export const englishT = (key, options) => i18n.getFixedT("en", "analytics")(key, options);

export function minorUnits(value) {
  if (typeof value !== "string" || !/^(0|-?[1-9]\d*)$/.test(value)) {
    throw new Error("Invalid cash-flow amount");
  }
  return BigInt(value);
}

export function formatCash(value, { signed = false, locale = "en" } = {}) {
  const amount = minorUnits(value);
  const absolute = amount < 0n ? -amount : amount;
  const sign = amount < 0n ? "−" : signed && amount > 0n ? "+" : "";
  return `${sign}${formatMoneyCents(absolute, locale)}`;
}

// Round the exact ratio to one percentage decimal, with halfway values upward.
// Never convert a financial amount or ratio intermediate to Number.
export function cashPercentage(numerator, denominator, locale = "en") {
  const part = minorUnits(numerator);
  const whole = minorUnits(denominator);
  if (whole <= 0n) return null;
  const tenths = (part * 2000n + whole) / (whole * 2n);
  return formatPercentTenths(tenths, locale);
}

// Approximation is exclusively for decorative chart/bar geometry.
export function barWidth(amount, maximum) {
  const part = minorUnits(amount);
  const whole = minorUnits(maximum);
  return whole > 0n ? `${Number((part * 10000n) / whole) / 100}%` : "0%";
}

export function localThroughDate(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Month names come from the catalog and are applied to the existing year-month
// and date components; no Date object, timezone, or locale formatter is involved.
function monthName(month, short, t) {
  return t(`months.${short ? "short" : "long"}.${month.slice(5, 7)}`);
}

export function cashMonthLabel(month, { short = false, t = englishT } = {}) {
  return t("labels.month", { month: monthName(month, short, t), year: month.slice(0, 4) });
}

// Month and year as separate parts, for the chart's two-line axis ticks.
export function cashMonthTickParts(month, { t = englishT } = {}) {
  return [monthName(month, true, t), month.slice(0, 4)];
}

export function cashDateLabel(date, { t = englishT } = {}) {
  return t("labels.date", { month: monthName(date, false, t), day: Number(date.slice(8, 10)), year: date.slice(0, 4) });
}

export function periodNotes(bucket, throughDate, { t = englishT } = {}) {
  const notes = [];
  if (bucket.month === throughDate.slice(0, 7)) notes.push(t("periodNotes.through", { date: cashDateLabel(bucket.to, { t }) }));
  if (bucket.cashInMinor === "0") notes.push(t("periodNotes.noCashIn"));
  if (bucket.spentMinor === "0") notes.push(t("periodNotes.noSpending"));
  return notes.join(" · ") || "—";
}
