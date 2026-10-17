import Foundation

enum AttentionRow: Equatable, Sendable, Identifiable {
    case budget(BudgetAttentionItem)
    case commitment(CommitmentAttentionItem)

    var id: String {
        switch self {
        case .budget(let item): "budget-\(item.id)"
        case .commitment(let item): "commitment-\(item.id)"
        }
    }
}

/// Display rules shared by the Home views and their tests.
struct HomePresenter: Sendable {
    let l10n: L10n
    let currencyCode: String

    private var money: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: currencyCode) }

    // MARK: Attention

    /// Actionable budget items, then commitment items, then `at_limit` items, capped at 2.
    /// The app computes this order itself rather than trusting the server's sort order.
    static func attentionRows(_ content: AttentionContent) -> [AttentionRow] {
        func rank(_ item: BudgetAttentionItem) -> Int64 {
            switch item.state {
            case .overLimit: item.spent.cents - item.limit.cents
            case .zeroLimitSpending: item.spent.cents
            case .atLimit: 0
            }
        }
        let actionable = content.budgetItems.filter { $0.state != .atLimit }
            .sorted { (rank($0), $1.category) > (rank($1), $0.category) }
        let atLimit = content.budgetItems.filter { $0.state == .atLimit }.sorted { $0.category < $1.category }
        let rows = actionable.map(AttentionRow.budget)
            + content.commitmentItems.sorted { $0.id < $1.id }.map(AttentionRow.commitment)
            + atLimit.map(AttentionRow.budget)
        return Array(rows.prefix(2))
    }

    func title(for row: AttentionRow) -> String {
        switch row {
        case .budget(let item): categoryLabel(item.category)
        case .commitment(let item): item.name
        }
    }

    func detail(for row: AttentionRow) -> String {
        switch row {
        case .budget(let item):
            let spent = money.string(item.spent), limit = money.string(item.limit)
            switch item.state {
            case .atLimit: return l10n.string(.homeAttentionBudgetStatesAtLimit, spent, limit)
            case .overLimit: return l10n.string(.homeAttentionBudgetStatesOverLimit, spent, limit)
            case .zeroLimitSpending: return l10n.string(.homeAttentionBudgetStatesZeroLimitSpending, spent)
            }
        case .commitment(let item):
            var seen = Set<ReviewReason.Dimension>()
            let parts = item.reviews.compactMap { review -> String? in
                guard seen.insert(review.dimension).inserted else { return nil }
                switch review.dimension {
                case .amount: return l10n.string(.homeAttentionDimensionsAmount)
                case .timing: return l10n.string(.homeAttentionDimensionsTiming)
                case .missing: return l10n.string(.homeAttentionDimensionsMissing)
                }
            }
            return parts.joined(separator: l10n.string(.homeAttentionReasonSeparator))
        }
    }

    // MARK: Recent activity

    func categoryLabel(_ category: String?) -> String { CategoryLabel.label(for: category, l10n: l10n) }

    func amount(for item: ActivityItem) -> String { money.signedString(item.amount, kind: item.kind) }

    func date(_ date: CalendarDate) -> String { DateFormatting.string(date, language: l10n.language) }

    func kindLabel(_ kind: ActivityItem.Kind) -> String {
        kind == .expense ? l10n.string(.homeActivityExpense) : l10n.string(.homeActivityCashIn)
    }

    // MARK: Upcoming

    func cadenceLabel(_ cadence: UpcomingItem.Cadence) -> String {
        switch cadence {
        case .weekly: l10n.string(.homeComingUpCadencesWeekly)
        case .biweekly: l10n.string(.homeComingUpCadencesBiweekly)
        case .semimonthly: l10n.string(.homeComingUpCadencesSemimonthly)
        case .monthly: l10n.string(.homeComingUpCadencesMonthly)
        }
    }

    func amountText(_ amount: UpcomingItem.Amount) -> String {
        switch amount {
        case .fixed(let value):
            l10n.string(.homeComingUpFixedAmount, money.string(value))
        case .range(let minimum, let maximum):
            l10n.string(.homeComingUpRangeAmount, money.string(minimum), money.string(maximum))
        }
    }

    func windowText(_ item: UpcomingItem) -> String {
        if item.earliestExpectedDate == item.latestExpectedDate {
            return l10n.string(.homeComingUpExpectedDate, date(item.anchorDate))
        }
        return l10n.string(.homeComingUpExpectedWindow, date(item.earliestExpectedDate), date(item.latestExpectedDate))
    }

    /// Combined VoiceOver label for an upcoming row.
    func accessibilityLabel(_ item: UpcomingItem) -> String {
        let amount: String
        switch item.amount {
        case .fixed(let value): amount = l10n.string(.homeComingUpFixedAmount, money.string(value))
        case .range(let minimum, let maximum):
            amount = l10n.string(.homeComingUpRangeValue, money.string(minimum), money.string(maximum))
        }
        return l10n.string(.homeComingUpItemLabel, item.displayName, amount, cadenceLabel(item.cadence), windowText(item))
    }
}
