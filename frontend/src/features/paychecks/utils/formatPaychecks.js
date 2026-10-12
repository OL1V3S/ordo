import { formatCalendarDate, formatMoneyDecimal } from "../../../shared/localization/format";
import i18n from "../../../shared/localization/i18n";
import { isCalendarDate, isUnsafeNumericAmount } from "./paycheckForm";

const CADENCE_LABELS = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

// Callers that render localized copy pass their own `t`. Callers that have not adopted
// localization yet keep the English catalog wording, read from the same English catalog.
export const englishT = (key, options) => i18n.getFixedT("en", "paychecks")(key, options);

export function formatDate(value, t = englishT, locale = "en") {
  if (!isCalendarDate(String(value ?? ""))) return t("format.unknownDate");
  return formatCalendarDate(value, locale, "short") ?? t("format.unknownDate");
}

export function formatMoney(value, t = englishT, locale = "en") {
  if (isUnsafeNumericAmount(value)) return t("format.amountNeedsReview");
  if (value == null || value === "" || !Number.isFinite(Number(value))) return t("format.amountUnavailable");
  // String decimal values retain their cents, including at numeric(18,2)'s limit.
  return formatMoneyDecimal(value, locale) ?? t("format.amountNeedsReview");
}

export function cadenceLabel(cadence, t = englishT) {
  return t(CADENCE_LABELS.has(cadence) ? `cadence.${cadence}` : "cadence.unknown");
}

function formatAnchor(anchor, t) {
  return anchor?.kind === "month_end" ? t("format.monthEnd") : t("format.dayOfMonth", { day: anchor?.day ?? "?" });
}

export function formatSchedule(schedule, t = englishT, locale = "en") {
  if (!schedule) return t("format.scheduleUnavailable");
  const cadence = cadenceLabel(schedule.cadence, t);
  if (["weekly", "biweekly"].includes(schedule.cadence))
    return t("format.scheduleReference", { cadence, date: formatDate(schedule.referenceAnchorDate, t, locale) });
  if (schedule.cadence === "semimonthly")
    return t("format.scheduleSemimonthly", { cadence, first: formatAnchor(schedule.firstMonthAnchor, t), second: formatAnchor(schedule.secondMonthAnchor, t) });
  return t("format.scheduleMonthly", { cadence, first: formatAnchor(schedule.firstMonthAnchor, t) });
}

export function formatAmount(amount, t = englishT, locale = "en") {
  if (!amount) return t("format.amountUnavailable");
  if (amount.mode === "fixed") return formatMoney(amount.fixedAmount, t, locale);
  return `${formatMoney(amount.minimumAmount, t, locale)} – ${formatMoney(amount.maximumAmount, t, locale)}`;
}

export function formatWindow(before, after, t = englishT) {
  return t("format.window", {
    before: t("format.daysBefore", { count: Number(before), value: before }),
    after: t("format.daysAfter", { count: Number(after), value: after }),
  });
}
