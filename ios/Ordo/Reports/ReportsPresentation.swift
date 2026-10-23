import Foundation

/// Month and date labels, period notes and category order: the web catalog and rules, not a system
/// date formatter. Labels are built from the key text, never from a `Date`.
struct ReportsPresenter: Sendable {
    let l10n: L10n
    let formatter: ReportsFormatter

    init(l10n: L10n) {
        self.l10n = l10n
        formatter = ReportsFormatter(language: l10n.language)
    }

    private static let longKeys: [L10nKey] = [
        .analyticsMonthsLong01, .analyticsMonthsLong02, .analyticsMonthsLong03, .analyticsMonthsLong04,
        .analyticsMonthsLong05, .analyticsMonthsLong06, .analyticsMonthsLong07, .analyticsMonthsLong08,
        .analyticsMonthsLong09, .analyticsMonthsLong10, .analyticsMonthsLong11, .analyticsMonthsLong12,
    ]
    private static let shortKeys: [L10nKey] = [
        .analyticsMonthsShort01, .analyticsMonthsShort02, .analyticsMonthsShort03, .analyticsMonthsShort04,
        .analyticsMonthsShort05, .analyticsMonthsShort06, .analyticsMonthsShort07, .analyticsMonthsShort08,
        .analyticsMonthsShort09, .analyticsMonthsShort10, .analyticsMonthsShort11, .analyticsMonthsShort12,
    ]

    func monthName(_ month: BudgetMonth, short: Bool = false) -> String {
        l10n.string((short ? Self.shortKeys : Self.longKeys)[month.month - 1])
    }

    func yearText(_ month: BudgetMonth) -> String { String(month.key.prefix(4)) }

    /// "October 2026" / "octubre de 2026".
    func monthLabel(_ month: BudgetMonth, short: Bool = false) -> String {
        l10n.string(.analyticsLabelsMonth, monthName(month, short: short), yearText(month))
    }

    /// The two-line axis tick: short month and year.
    func tickParts(_ month: BudgetMonth) -> (month: String, year: String) {
        (monthName(month, short: true), yearText(month))
    }

    /// "October 20, 2026" / "20 de octubre de 2026".
    func dateLabel(_ date: CalendarDate) -> String {
        l10n.string(.analyticsLabelsDate, monthName(BudgetMonth(containing: date)), String(date.day),
                    String(date.isoString.prefix(4)))
    }

    /// Up to three factual notes joined with " · ", otherwise "—".
    func periodNotes(_ bucket: CashFlowMonth, throughDate: CalendarDate) -> String {
        var notes: [String] = []
        if bucket.month == BudgetMonth(containing: throughDate) {
            notes.append(l10n.string(.analyticsPeriodNotesThrough, dateLabel(bucket.to)))
        }
        if bucket.cashIn.isZero { notes.append(l10n.string(.analyticsPeriodNotesNoCashIn)) }
        if bucket.spent.isZero { notes.append(l10n.string(.analyticsPeriodNotesNoSpending)) }
        return notes.isEmpty ? "—" : notes.joined(separator: " · ")
    }

    /// The trend kicker: six months, or the count and start at the calendar floor.
    func trendKicker(monthCount: Int) -> String {
        guard monthCount != 6 else { return l10n.string(.analyticsChartKickerSixMonths) }
        let start = monthLabel(BudgetMonth.earliest)
        return l10n.string(monthCount == 1 ? .analyticsChartKickerFromFloorOne : .analyticsChartKickerFromFloorOther,
                           String(monthCount), start)
    }

    func percentage(_ part: CashAmount, of whole: CashAmount, fallback: L10nKey) -> String {
        formatter.percentage(part, of: whole) ?? l10n.string(fallback)
    }

    /// The web's category order: amount descending, then English collation of the stored name.
    static func ordered(_ categories: [CashFlowCategory]) -> [CashFlowCategory] {
        let english = Locale(identifier: "en")
        return categories.sorted { left, right in
            if left.amount != right.amount { return left.amount > right.amount }
            return left.category.compare(right.category, options: [], range: nil, locale: english) == .orderedAscending
        }
    }

    /// The months the picker lists: the current and selected months and every available month,
    /// without repeats, newest first.
    static func monthOptions(current: BudgetMonth, selected: BudgetMonth, available: [BudgetMonth]) -> [BudgetMonth] {
        Array(Set(available + [current, selected])).sorted(by: >)
    }

    /// The nearest listed month before (`direction < 0`) or after (`> 0`) `selected`.
    static func neighbor(of selected: BudgetMonth, in options: [BudgetMonth], direction: Int) -> BudgetMonth? {
        direction < 0 ? options.filter { $0 < selected }.max() : options.filter { $0 > selected }.min()
    }
}
