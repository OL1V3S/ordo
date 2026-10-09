import { formatCalendarDate } from "../../../shared/localization/format";

export function formatLocalCalendarDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localCalendarDateDaysAgo(days, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - days);
  return formatLocalCalendarDate(date);
}

export function formatExpenseDate(date, locale = "en") {
  const exact = formatCalendarDate(date, locale, "numeric");
  if (exact !== null) return exact;
  const [year, month, day] = String(date).split("-");
  return year && month && day ? `${month}/${day}/${year}` : "";
}
