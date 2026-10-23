import Foundation

/// One bar of the widget's six-month spending graph.
struct WidgetBar: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let month: BudgetMonth
    /// Exact text from `ReportsFormatter.cash`.
    let spentText: String
    /// Bar height 0...1, geometry only.
    let fraction: Double
    /// The current month, which is month-to-date.
    let isCurrent: Bool

    var description: String { "WidgetBar(redacted)" }
    var debugDescription: String { "WidgetBar(redacted)" }
}

/// What the widget shows after a successful read. Nothing here is stored: it exists only in the
/// timeline entry built from a fresh read.
struct WidgetSpending: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let month: BudgetMonth
    let throughDate: CalendarDate
    /// The current month's exact spent text, as the server sent it.
    let currentSpentText: String
    /// The current month's spending is exactly zero.
    let isEmpty: Bool
    /// Oldest first, at most six, the last one is the current month.
    let bars: [WidgetBar]
    let fetchedAt: Date
    let language: AppLanguage

    /// False once the device's month has moved past the figures' month, so a month-to-date figure
    /// is never shown as the new month.
    func isCurrent(at date: Date, timeZone: TimeZone) -> Bool {
        BudgetMonth.current(now: date, timeZone: timeZone) == month
    }

    /// "now", "15 minutes ago" / "ahora", "hace 15 minutos".
    func updatedText(at date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = language.formatLocale
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .full
        return formatter.localizedString(for: min(fetchedAt, date), relativeTo: date)
    }

    /// "Oct" / "oct": formatted in UTC from the month's own numbers, never shifted by time zone.
    static func shortMonthName(_ month: BudgetMonth, language: AppLanguage) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(from: DateComponents(timeZone: calendar.timeZone, year: month.year,
                                                            month: month.month, day: 1, hour: 12)) else { return month.key }
        let style = Date.FormatStyle(date: .omitted, time: .omitted, locale: language.formatLocale,
                                     calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated)
        return style.format(date).replacingOccurrences(of: ".", with: "")
    }

    /// Builds the widget figures from a validated report. Nil (shown as "Couldn't update spending")
    /// when the months are repeated, out of order after sorting, or do not include the current month.
    static func map(_ report: CashFlowReport, language: AppLanguage, fetchedAt: Date) -> WidgetSpending? {
        let sorted = report.months.sorted { $0.month < $1.month }
        guard Set(sorted.map(\.month)).count == sorted.count,
              let last = sorted.last, last.month == report.month else { return nil }
        let shown = Array(sorted.suffix(6))
        let formatter = ReportsFormatter(language: language)
        // Compared, never summed.
        let maximum = shown.map(\.spent).max() ?? CashAmount(0)
        let bars = shown.map { bucket in
            WidgetBar(month: bucket.month, spentText: formatter.cash(bucket.spent),
                      fraction: min(1, max(0, ReportsFormatter.barFraction(bucket.spent, of: maximum))),
                      isCurrent: bucket.month == report.month)
        }
        return WidgetSpending(month: report.month, throughDate: report.throughDate,
                              currentSpentText: formatter.cash(report.selected.spent),
                              isEmpty: report.selected.spent.isZero, bars: bars, fetchedAt: fetchedAt,
                              language: language)
    }

    var description: String { "WidgetSpending(redacted)" }
    var debugDescription: String { "WidgetSpending(redacted)" }
}

enum WidgetSpendingState: Equatable, Sendable {
    /// No server address in the build.
    case notConfigured
    /// No widget item: "Sign in to Ordo".
    case signedOut
    /// Token too old, expired or refused (`401`): "Open Ordo to update".
    case needsUpdate
    /// Offline, a server error or a malformed response: "Couldn't update spending".
    case unavailable
    case loaded(WidgetSpending)
}

/// The widget's read. It only reads the shared access-token item; it never refreshes, writes or
/// deletes anything, and a token that is too old or expired is not sent at all.
struct WidgetSpendingLoader: Sendable {
    let baseURL: URL?
    let readAccess: @Sendable () -> WidgetAccess?
    /// Sends the request; returns the body and status. Throws when offline.
    let send: @Sendable (URLRequest) async throws -> (Data, Int)
    let language: AppLanguage
    let timeZone: TimeZone

    func load(now: Date) async -> WidgetSpendingState {
        guard let baseURL else { return .notConfigured }
        return await attempt(baseURL: baseURL, now: now, retriesLeft: 1)
    }

    private func attempt(baseURL: URL, now: Date, retriesLeft: Int) async -> WidgetSpendingState {
        guard let access = readAccess() else { return .signedOut }
        guard access.isUsable(now: now) else { return .needsUpdate }
        let today = DateFormatting.localCalendarDate(now: now, timeZone: timeZone)
        let month = BudgetMonth(containing: today)
        guard let request = CashFlowRequest.make(baseURL: baseURL, accessToken: access.accessToken,
                                                 month: month, throughDate: today) else { return .unavailable }
        let result: WidgetSpendingState
        do {
            let (data, status) = try await send(request)
            switch CashFlowRequest.outcome(status: status) {
            case .ok:
                if let report = try? CashFlowValidation.parse(data, month: month, throughDate: today),
                   let spending = WidgetSpending.map(report, language: language, fetchedAt: now) {
                    result = .loaded(spending)
                } else {
                    result = .unavailable
                }
            case .unauthorized: result = .needsUpdate
            case .server: result = .unavailable
            }
        } catch {
            result = .unavailable
        }
        // Signed out or signed in again while the request ran: drop the result.
        guard let after = readAccess() else { return .signedOut }
        guard after == access else {
            return retriesLeft > 0 ? await attempt(baseURL: baseURL, now: now, retriesLeft: retriesLeft - 1) : .needsUpdate
        }
        return result
    }
}
