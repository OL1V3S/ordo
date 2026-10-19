import Foundation

/// How a limit compares with the spending recorded against it: a strict port of the web's
/// `BudgetLimitsPanel` status, percent and near-limit rules. Everything is integer cents. The
/// percent and the 90% check use `Int128` because `used * 1000` and `used * 100` overflow `Int64`
/// near `Money.maximumCents`. There is no floating point in any money comparison.
struct BudgetEvaluation: Equatable, Sendable {
    let status: BudgetStatus
    /// The category's total in cents; nil when it cannot be read exactly.
    let usedCents: Int64?
    /// The limit in cents; nil when it cannot be read exactly.
    let limitCents: Int64?
    /// Spending is available and both amounts are exact.
    let comparisonAvailable: Bool
    /// Tenths of a percent, rounded half up, for a positive limit with an exact comparison.
    let percentTenths: Int128?
    /// Zero limit, or used at or above 90% of the limit (UI only, never a Home attention state).
    let warning: Bool
    let spendingAvailable: Bool

    /// The percent text rounds the tenths to whole percent, half up, and is not capped (150% stays
    /// 150%).
    var percentWhole: Int128? { percentTenths.map { ($0 + 5) / 10 } }

    /// The progress bar is capped at 100%: 0...1000 tenths.
    var barTenths: Int? { percentTenths.map { Int(min($0, 1000)) } }

    /// "Spending available but used or limit unreadable": the comparison note is shown.
    var showsComparisonUnavailable: Bool { spendingAvailable && (usedCents == nil || limitCents == nil) }
    var showsZeroLimitNote: Bool { comparisonAvailable && limitCents == 0 }
}

enum BudgetRules {
    /// The near-limit threshold: used at or above 90% of the limit.
    static func isAtOrAboveNinetyPercent(used: Int64, limit: Int64) -> Bool {
        Int128(used) * 100 >= Int128(limit) * 90
    }

    /// Tenths of a percent, rounded half up: `(used * 1000 + limit / 2) / limit`. Nil for a zero limit.
    static func percentTenths(used: Int64, limit: Int64) -> Int128? {
        guard limit > 0 else { return nil }
        let divisor = Int128(limit)
        return (Int128(used) * 1000 + divisor / 2) / divisor
    }

    /// `spendingAvailable` is false while spending loads or when it failed (the web shows
    /// "Spending unavailable" for both).
    static func evaluate(spendingAvailable: Bool, used: BudgetSpending.Total, limit: BudgetLimitValue) -> BudgetEvaluation {
        var usedCents: Int64?
        if case .cents(let cents) = used { usedCents = cents }
        var limitCents: Int64?
        if case .exact(let money) = limit { limitCents = money.cents }

        var comparison: (used: Int64, limit: Int64)?
        if spendingAvailable, let usedCents, let limitCents { comparison = (usedCents, limitCents) }

        let tenths = comparison.flatMap { percentTenths(used: $0.used, limit: $0.limit) }
        let warning = comparison.map { $0.limit == 0 || isAtOrAboveNinetyPercent(used: $0.used, limit: $0.limit) } ?? false

        let status: BudgetStatus
        if !spendingAvailable {
            status = .spendingUnavailable
        } else if usedCents == nil {
            status = .spendingNeedsReview
        } else if limitCents == nil {
            status = .limitNeedsReview
        } else if let comparison {
            if comparison.limit == 0 {
                // Any spending, including above zero: this is the web's precedence.
                status = .zeroLimit
            } else if comparison.used > comparison.limit {
                status = .overLimit
            } else if comparison.used == comparison.limit {
                status = .limitReached
            } else {
                status = warning ? .nearLimit : .withinLimit
            }
        } else {
            status = .spendingNeedsReview
        }
        // While spending is unavailable, "used" is never shown, whatever total was passed in.
        return BudgetEvaluation(status: status, usedCents: spendingAvailable ? usedCents : nil, limitCents: limitCents,
                                comparisonAvailable: comparison != nil, percentTenths: tenths, warning: warning,
                                spendingAvailable: spendingAvailable)
    }

    /// One row per exact category: the last row the server returned wins, as on the web. Rows are
    /// shown in the order each category first appears. Rows are never merged, repaired or deleted.
    static func shownRows(_ rows: [BudgetLimitRow]) -> [BudgetLimitRow] {
        var order: [ExactCategoryKey] = []
        var latest: [ExactCategoryKey: BudgetLimitRow] = [:]
        for row in rows {
            let key = row.key
            if latest[key] == nil { order.append(key) }
            latest[key] = row
        }
        return order.compactMap { latest[$0] }
    }
}
