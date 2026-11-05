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

    /// One donut slice: a category, or the grouped remainder (`category` nil, `count` categories).
    struct CategoryShare: Equatable, Sendable {
        let category: String?
        let amount: CashAmount
        let count: Int
        var isOther: Bool { category == nil }
    }

    /// The donut slices in list order. Above `cap` categories the top `cap - 1` stay and the rest are
    /// summed exactly into one Other slice. Empty when nothing was spent.
    static func categoryShares(_ categories: [CashFlowCategory], spent: CashAmount, cap: Int = 6) -> [CategoryShare] {
        guard spent.isPositive else { return [] }
        let sorted = ordered(categories)
        let slices = { (list: ArraySlice<CashFlowCategory>) in list.map { CategoryShare(category: $0.category, amount: $0.amount, count: 1) } }
        guard sorted.count > cap else { return slices(sorted[...]) }
        let rest = sorted[(cap - 1)...]
        let total = rest.reduce(Int128(0)) { $0 + $1.amount.value }
        return slices(sorted[..<(cap - 1)]) + [CategoryShare(category: nil, amount: CashAmount(total), count: rest.count)]
    }

    /// One date of a month with its exact running total.
    struct DayPoint: Equatable, Sendable {
        let date: CalendarDate
        let day: Int
        let spent: CashAmount
        let cumulative: CashAmount
    }

    /// A month's days with an exact running total. Bounded: validation checked every month's sum.
    static func cumulativeDays(_ bucket: CashFlowMonth) -> [DayPoint] {
        var running = Int128(0)
        return bucket.days.map { entry in
            running += entry.spent.value
            return DayPoint(date: entry.date, day: entry.date.day, spent: entry.spent, cumulative: CashAmount(running))
        }
    }

    /// The month before the selected (last) one, or nil at the representable-calendar floor.
    static func previousMonth(_ months: [CashFlowMonth]) -> CashFlowMonth? {
        months.count >= 2 ? months[months.count - 2] : nil
    }

    /// One stacked-bar series: a category, or the grouped remainder (`category` nil, `count` categories).
    struct CategorySeries: Equatable, Sendable {
        let category: String?
        let count: Int
        /// One exact amount per month, in month order.
        let amounts: [CashAmount]
        var isOther: Bool { category == nil }
    }

    /// Series ranked by window total. Above `cap` the top `cap - 1` stay and the rest are summed
    /// exactly into Other. Empty when no month has category spending.
    static func categoryTrend(_ months: [CashFlowMonth], cap: Int = 6) -> [CategorySeries] {
        var totals: [String: Int128] = [:]
        for bucket in months { for row in bucket.categories { totals[row.category, default: 0] += row.amount.value } }
        let ranked = ordered(totals.map { CashFlowCategory(category: $0.key, amount: CashAmount($0.value)) })
        guard ranked.contains(where: { $0.amount.isPositive }) else { return [] }
        func series(_ category: String?, _ names: Set<String>, _ count: Int) -> CategorySeries {
            let amounts = months.map { bucket in
                CashAmount(bucket.categories.filter { names.contains($0.category) }.reduce(Int128(0)) { $0 + $1.amount.value })
            }
            return CategorySeries(category: category, count: count, amounts: amounts)
        }
        let kept = ranked.count <= cap ? ranked : Array(ranked.prefix(cap - 1))
        let rest = ranked.dropFirst(kept.count)
        var result = kept.map { series($0.category, [$0.category], 1) }
        if !rest.isEmpty { result.append(series(nil, Set(rest.map(\.category)), rest.count)) }
        return result
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
