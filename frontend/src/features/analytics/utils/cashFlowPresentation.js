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
  // Cash-flow shares have always been ungrouped (for example 1234.5%); keep that.
  return formatPercentTenths(tenths, locale, { grouping: false });
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

// The list's order: amount descending, then the stored name (English collation).
export function sortCategories(categories) {
  return [...(categories ?? [])].sort((left, right) => {
    const difference = minorUnits(right.amountMinor) - minorUnits(left.amountMinor);
    return difference > 0n ? 1 : difference < 0n ? -1 : left.category.localeCompare(right.category, "en");
  });
}

// Donut slices in list order. Above `cap` categories, the top cap - 1 stay and the rest are
// summed exactly into one Other slice. Empty when nothing was spent. Amounts stay exact strings;
// `Number` is for plot geometry only, where the chart is built.
export function categoryShares(categories, spentMinor, { cap = 6 } = {}) {
  if (minorUnits(spentMinor) <= 0n) return [];
  const sorted = sortCategories(categories);
  if (sorted.length <= cap) return sorted.map(({ category, amountMinor }) => ({ category, amountMinor, other: false, count: 1 }));
  const rest = sorted.slice(cap - 1);
  const total = rest.reduce((sum, { amountMinor }) => sum + minorUnits(amountMinor), 0n);
  return [
    ...sorted.slice(0, cap - 1).map(({ category, amountMinor }) => ({ category, amountMinor, other: false, count: 1 })),
    { category: null, amountMinor: total.toString(), other: true, count: rest.length },
  ];
}

// Net per month for plotting only; tooltips and the table keep exact strings.
export function netSeries(months) {
  return months.map((bucket) => Number(minorUnits(bucket.netMinor)) / 100);
}

// A month's days with an exact running total. `plot` is a decorative Number for chart geometry only.
export function cumulativeDays(bucket) {
  let running = 0n;
  return (bucket?.days ?? []).map(({ date, spentMinor }) => {
    running += minorUnits(spentMinor);
    return { date, day: Number(date.slice(8, 10)), spentMinor, cumulativeMinor: running.toString(), plot: Number(running) / 100 };
  });
}

// The month before the selected (last) one, or null at the representable-calendar floor.
export function previousMonth(months) {
  return months.length >= 2 ? months[months.length - 2] : null;
}

// Stacked-bar series across the window, ranked by window total. Above `cap` series the top
// cap - 1 stay and the rest are summed exactly into Other. Empty when nothing was spent.
export function categoryTrend(months, { cap = 6 } = {}) {
  const totals = new Map();
  const amountFor = (bucket, name) => (bucket.categories ?? []).find((row) => row.category === name)?.amountMinor ?? "0";
  for (const bucket of months) {
    for (const { category, amountMinor } of bucket.categories ?? []) {
      totals.set(category, (totals.get(category) ?? 0n) + minorUnits(amountMinor));
    }
  }
  const ranked = sortCategories([...totals].map(([category, total]) => ({ category, amountMinor: total.toString() })));
  if (ranked.length === 0 || ranked.every(({ amountMinor }) => minorUnits(amountMinor) === 0n)) return [];
  const series = (category, names, other) => {
    const amounts = months.map((bucket) => names.reduce((sum, name) => sum + minorUnits(amountFor(bucket, name)), 0n).toString());
    return { category, other, count: names.length, amounts, plot: amounts.map((amount) => Number(amount) / 100) };
  };
  const kept = ranked.length <= cap ? ranked : ranked.slice(0, cap - 1);
  const rest = ranked.slice(kept.length);
  return [
    ...kept.map(({ category }) => series(category, [category], false)),
    ...(rest.length ? [series(null, rest.map(({ category }) => category), true)] : []),
  ];
}
