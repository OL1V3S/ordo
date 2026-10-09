import { useMemo } from "react";
import {
  formatCalendarDate,
  formatDateTime,
  formatMoneyCents,
  formatMoneyDecimal,
  formatMonthYear,
  formatPercentTenths,
  formatPercentWhole,
} from "./format";
import { useLocale } from "./useLocale";

// Locale-bound versions of the shared formatters, following the active app language.
export function useFormatters() {
  const { locale } = useLocale();
  return useMemo(() => ({
    locale,
    formatMoneyCents: (cents, options) => formatMoneyCents(cents, locale, options),
    formatMoneyDecimal: (value, options) => formatMoneyDecimal(value, locale, options),
    formatPercentTenths: (tenths) => formatPercentTenths(tenths, locale),
    formatPercentWhole: (value) => formatPercentWhole(value, locale),
    formatCalendarDate: (value, style) => formatCalendarDate(value, locale, style),
    formatMonthYear: (year, month) => formatMonthYear(year, month, locale),
    formatDateTime: (value, options) => formatDateTime(value, locale, options),
  }), [locale]);
}
