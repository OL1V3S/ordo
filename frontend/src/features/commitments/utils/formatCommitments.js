import { formatCalendarDate, formatMoneyDecimal } from "../../../shared/localization/format";
import i18n from "../../../shared/localization/i18n";
import { AMOUNT_NEEDS_REVIEW, formatExactMoney } from "../../expenses/utils/exactMoney";

const CADENCES = new Set(["weekly", "monthly", "yearly"]);
const LIFECYCLES = new Set(["active", "paused", "ended"]);
const WEEKDAYS = new Set(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
const EVIDENCE_RULES = new Set(["consecutive_calendar_months", "weekly_six_to_eight_day_gaps", "consecutive_years_same_month"]);

// Callers that render localized copy pass their own `t`. Callers that have not adopted
// localization yet keep the English catalog wording, read from the same English catalog.
export const englishT = (key, options) => i18n.getFixedT("en", "commitments")(key, options);

// Missing or unparseable amounts show the shared "Amount needs review" label instead of
// a fabricated zero or NaN amount.
export function formatMoney(value, locale = "en") {
  return formatMoneyDecimal(value, locale) ?? AMOUNT_NEEDS_REVIEW;
}

export function formatDerivedMoney(value, locale = "en") {
  return formatExactMoney(value, undefined, locale);
}

export function formatDate(value, t = englishT, locale = "en") {
  if (!value) return t("format.unknownDate");
  return formatCalendarDate(value, locale, "short") ?? t("format.unknownDate");
}

// Readable fallback for a stable backend value that has no catalog label.
export function title(value) {
  const text = value?.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2") ?? "";
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function cadenceLabel(value, t = englishT) {
  return CADENCES.has(value) ? t(`cadence.${value}`) : title(value);
}

export function lifecycleLabel(value, t = englishT) {
  return LIFECYCLES.has(value) ? t(`lifecycle.${value}`) : title(value);
}

export function weekdayLabel(value, t = englishT) {
  const key = String(value ?? "").toLowerCase();
  return WEEKDAYS.has(key) ? t(`weekday.${key}`) : title(value);
}

export function evidenceRuleLabel(value, t = englishT) {
  return EVIDENCE_RULES.has(value) ? t(`evidence.rules.${value}`) : title(value);
}
