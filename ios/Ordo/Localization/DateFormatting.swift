import Foundation

enum DateFormatting {
    private static var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    /// Short calendar date such as "Oct 17, 2026". The day is formatted in UTC from its own
    /// components, so it never shifts with the device time zone.
    static func string(_ date: CalendarDate, language: AppLanguage) -> String {
        let calendar = utcCalendar
        guard let value = calendar.date(from: DateComponents(timeZone: calendar.timeZone, year: date.year,
                                                              month: date.month, day: date.day, hour: 12)) else {
            return date.isoString
        }
        let style = Date.FormatStyle(date: .abbreviated, time: .omitted, locale: language.formatLocale,
                                     calendar: calendar, timeZone: calendar.timeZone)
        return style.format(value)
    }

    /// The device-local calendar day (Gregorian, zero-padded) used as `activityThroughDate`,
    /// independent of `Calendar.current` (a user may have a non-Gregorian calendar).
    static func localCalendarDate(now: Date, timeZone: TimeZone) -> CalendarDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return CalendarDate(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1)
            ?? CalendarDate(year: 1970, month: 1, day: 1)!
    }
}
