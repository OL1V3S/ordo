import Foundation

/// A calendar month with no day, time or time zone: the budget month. The wire values are exact
/// strings built from the two integers (`YYYY-MM` for the query, `YYYY-MM-01` for the upsert); a
/// `Date` is never used to build, step or compare a month. Only the visible label is
/// locale-aware, and it is never parsed back.
struct BudgetMonth: Hashable, Comparable, Sendable {
    /// 1...9999: the server's `DateTime` and the timeline's date validation stop there.
    let year: Int
    /// 1...12.
    let month: Int

    static let earliest = BudgetMonth(year: 1, month: 1)!
    static let latest = BudgetMonth(year: 9999, month: 12)!

    init?(year: Int, month: Int) {
        guard (1...9999).contains(year), (1...12).contains(month) else { return nil }
        self.year = year
        self.month = month
    }

    /// Strict `^\d{4}-\d{2}$` (ASCII digits only), month 1...12, year 1...9999.
    init?(key: String) {
        let bytes = Array(key.utf8)
        guard bytes.count == 7, bytes[4] == 0x2D else { return nil }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for index in range {
                let byte = bytes[index]
                guard byte >= 0x30, byte <= 0x39 else { return nil }
                value = value * 10 + Int(byte - 0x30)
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7) else { return nil }
        self.init(year: year, month: month)
    }

    /// The month containing a calendar day.
    init(containing day: CalendarDate) {
        self.year = day.year
        self.month = day.month
    }

    /// The device-local current month: Gregorian, in the device time zone, the same source as the
    /// spending cutoff and `DateFormatting.localCalendarDate`.
    static func current(now: Date, timeZone: TimeZone) -> BudgetMonth {
        BudgetMonth(containing: DateFormatting.localCalendarDate(now: now, timeZone: timeZone))
    }

    /// `YYYY-MM`, zero-padded to four and two digits.
    var key: String {
        let y = String(year)
        let m = String(month)
        return String(repeating: "0", count: 4 - y.count) + y + "-" + String(repeating: "0", count: 2 - m.count) + m
    }

    /// `YYYY-MM-01`: a date with no time and no offset, so the server stores the first of this
    /// month whatever the device or server time zone is.
    var monthYearWireValue: String { key + "-01" }

    /// Steps by whole months with integer arithmetic only; nil when the result leaves 0001-01...9999-12.
    func shifted(by delta: Int) -> BudgetMonth? {
        let index = year * 12 + (month - 1) + delta
        guard index >= 0 else { return nil }
        return BudgetMonth(year: index / 12, month: index % 12 + 1)
    }

    var previous: BudgetMonth? { shifted(by: -1) }
    var next: BudgetMonth? { shifted(by: 1) }

    var firstDay: CalendarDate { CalendarDate(year: year, month: month, day: 1)! }
    var lastDay: CalendarDate {
        CalendarDate(year: year, month: month, day: CalendarDate.daysInMonth(year: year, month: month))!
    }

    /// The first day of the next month, when limits start over; nil after 9999-12.
    var nextResetDay: CalendarDate? { next?.firstDay }

    static func < (lhs: BudgetMonth, rhs: BudgetMonth) -> Bool {
        (lhs.year, lhs.month) < (rhs.year, rhs.month)
    }

    /// "October 2026" / "octubre de 2026". Formatted in UTC from the month's own components, so it
    /// never shifts with the device time zone. For display only.
    func label(language: AppLanguage) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(from: DateComponents(timeZone: calendar.timeZone, year: year, month: month,
                                                            day: 1, hour: 12)) else { return key }
        let style = Date.FormatStyle(date: .omitted, time: .omitted, locale: language.formatLocale,
                                     calendar: calendar, timeZone: calendar.timeZone)
            .year().month(.wide)
        return style.format(date)
    }
}
