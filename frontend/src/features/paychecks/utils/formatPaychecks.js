import i18n from "../../../shared/localization/i18n";
import { isCalendarDate, isUnsafeNumericAmount } from "./paycheckForm";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CADENCE_LABELS = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

// Callers that render localized copy pass their own `t`. Callers that have not adopted
// localization yet keep the English catalog wording, read from the same English catalog.
export const englishT = (key, options) => i18n.getFixedT("en", "paychecks")(key, options);

export function formatDate(value, t = englishT) {
  if (!isCalendarDate(String(value ?? ""))) return t("format.unknownDate");
  const [year, month, day] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export function formatMoney(value, t = englishT) {
  if (isUnsafeNumericAmount(value)) return t("format.amountNeedsReview");
  if (value == null || value === "" || !Number.isFinite(Number(value))) return t("format.amountUnavailable");
  // String decimal values retain their cents, including at numeric(18,2)'s limit.
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (match) return `${match[1]}$${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").padEnd(2, "0")}`;
  return t("format.amountNeedsReview");
}

export function cadenceLabel(cadence, t = englishT) {
  return t(CADENCE_LABELS.has(cadence) ? `cadence.${cadence}` : "cadence.unknown");
}

function formatAnchor(anchor, t) {
  return anchor?.kind === "month_end" ? t("format.monthEnd") : t("format.dayOfMonth", { day: anchor?.day ?? "?" });
}

export function formatSchedule(schedule, t = englishT) {
  if (!schedule) return t("format.scheduleUnavailable");
  const cadence = cadenceLabel(schedule.cadence, t);
  if (["weekly", "biweekly"].includes(schedule.cadence))
    return t("format.scheduleReference", { cadence, date: formatDate(schedule.referenceAnchorDate, t) });
  if (schedule.cadence === "semimonthly")
    return t("format.scheduleSemimonthly", { cadence, first: formatAnchor(schedule.firstMonthAnchor, t), second: formatAnchor(schedule.secondMonthAnchor, t) });
  return t("format.scheduleMonthly", { cadence, first: formatAnchor(schedule.firstMonthAnchor, t) });
}

export function formatAmount(amount, t = englishT) {
  if (!amount) return t("format.amountUnavailable");
  if (amount.mode === "fixed") return formatMoney(amount.fixedAmount, t);
  return `${formatMoney(amount.minimumAmount, t)} – ${formatMoney(amount.maximumAmount, t)}`;
}

export function formatWindow(before, after, t = englishT) {
  return t("format.window", {
    before: t("format.daysBefore", { count: Number(before), value: before }),
    after: t("format.daysAfter", { count: Number(after), value: after }),
  });
}
