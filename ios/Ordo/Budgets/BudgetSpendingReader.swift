import Foundation

/// Why a month's recorded spending cannot be computed. A partial read never produces a sum.
enum BudgetSpendingError: Error, Equatable, Sendable {
    /// A page held something other than an expense inside the requested dates.
    case malformed
    /// A cursor repeated, or the month needed more pages than the safety cap allows.
    case runaway
}

/// Recorded spending for one month, read from `GET /api/activity/timeline` (`kind=expense`,
/// `from`, `to`, pages of 100) and paged to the end.
///
/// - A future month needs no request: every row shows `0.00` used (as on the web).
/// - A past month covers the whole month; the current month counts through today on the device
///   calendar (the web skips expenses dated after today).
/// - Any page failure, a malformed page or a tripped guard throws, so the whole month is
///   unavailable. The sums built so far are discarded.
/// - A repeated `recordId` is counted once (the first one seen is kept).
/// - Totals are integer cents per exact category (`ExactCategoryKey`). An amount that cannot be
///   read exactly (a stored zero or negative, a text `Money` rejects) makes that category
///   "needs review" and it stays so; a total above `Money.maximumCents` does too. An expense with a
///   blank or whitespace-only category is never aliased to "Uncategorized" and never omitted: it
///   marks the whole month as unreadable.
enum BudgetSpendingReader {
    static let pageSize = 100
    /// 100 pages of 100 are 10,000 expenses in one month.
    static let maximumPages = 100

    /// Nil when no spending needs reading (a future month).
    static func range(for month: BudgetMonth, today: CalendarDate) -> (from: CalendarDate, to: CalendarDate)? {
        let currentMonth = BudgetMonth(containing: today)
        if month > currentMonth { return nil }
        return (month.firstDay, month == currentMonth ? today : month.lastDay)
    }

    /// `loadPage` reads one timeline page, strictly validated (`TimelineValidation`).
    static func read(month: BudgetMonth, today: CalendarDate,
                     loadPage: @Sendable (TimelineQuery) async throws -> TimelinePage) async throws -> BudgetSpending {
        guard let (from, to) = range(for: month, today: today) else { return .empty }

        var filter = TimelineFilter()
        filter.kind = .expense
        filter.from = from
        filter.to = to

        var seen = Set<Int>()
        var totals: [ExactCategoryKey: BudgetSpending.Total] = [:]
        var blankCategory = false
        var cursors = Set<String>()
        var cursor: String?
        var pages = 0

        while true {
            try Task.checkCancellation()
            pages += 1
            guard pages <= maximumPages else { throw BudgetSpendingError.runaway }
            let page = try await loadPage(TimelineQuery(limit: pageSize, cursor: cursor, filter: filter))
            for item in page.items {
                guard item.kind == .expense, item.date >= from, item.date <= to, let category = item.category else {
                    throw BudgetSpendingError.malformed
                }
                guard seen.insert(item.recordId).inserted else { continue }
                if BudgetCategory.isBlank(category) {
                    blankCategory = true
                    continue
                }
                let key = ExactCategoryKey(category)
                if totals[key] == .needsReview { continue }
                guard case .exact(let amount) = item.amount else {
                    totals[key] = .needsReview
                    continue
                }
                var current: Int64 = 0
                if case .cents(let cents)? = totals[key] { current = cents }
                let sum = current + amount.cents
                totals[key] = sum > Money.maximumCents ? .needsReview : .cents(sum)
            }
            guard page.hasMore else { break }
            guard let next = page.nextCursor, cursors.insert(next).inserted else { throw BudgetSpendingError.runaway }
            cursor = next
        }
        return BudgetSpending(totals: totals, hasBlankCategoryExpense: blankCategory)
    }
}
