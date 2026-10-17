import Foundation

/// A section that can be shown, honestly unavailable, or hidden because its data failed validation.
enum SectionState<Content: Equatable & Sendable>: Equatable, Sendable {
    case available(Content)
    case unavailable
    case malformed
}

struct ActivityItem: Equatable, Sendable, Identifiable {
    enum Kind: String, Sendable { case expense, accountInflow = "account_inflow" }
    let kind: Kind
    let recordId: Int
    let date: CalendarDate
    let amount: Money
    let description: String
    let category: String?
    let paycheckLinked: Bool
    var id: String { "\(kind.rawValue)-\(recordId)" }
}

enum RecentActivityState: Equatable, Sendable {
    case available([ActivityItem])
    case unavailable
}

struct ReviewReason: Equatable, Sendable {
    enum Dimension: String, Sendable { case amount, timing, missing }
    let dimension: Dimension
    let state: String
}

struct CommitmentAttentionItem: Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let reviews: [ReviewReason]
}

struct BudgetAttentionItem: Equatable, Sendable, Identifiable {
    enum State: String, Sendable { case atLimit = "at_limit", overLimit = "over_limit", zeroLimitSpending = "zero_limit_spending" }
    let category: String
    let state: State
    let spent: Money
    let limit: Money
    var id: String { category }
}

struct AttentionContent: Equatable, Sendable {
    let commitmentItems: [CommitmentAttentionItem]
    let budgetItems: [BudgetAttentionItem]
    /// True when one of the two families could not be checked (the other is still shown).
    let isPartial: Bool
}

struct UpcomingItem: Equatable, Sendable, Identifiable {
    enum Cadence: String, Sendable { case weekly, biweekly, semimonthly, monthly }
    enum Amount: Equatable, Sendable {
        case fixed(Money)
        case range(minimum: Money, maximum: Money)
    }
    let profileId: String
    let displayName: String
    let cadence: Cadence
    let anchorDate: CalendarDate
    let earliestExpectedDate: CalendarDate
    let latestExpectedDate: CalendarDate
    let amount: Amount
    var id: String { profileId }
}

struct UpcomingContent: Equatable, Sendable {
    let from: CalendarDate
    let through: CalendarDate
    let items: [UpcomingItem]
}

struct HomeSnapshot: Equatable, Sendable {
    let currencyCode: String
    let activityThroughDate: CalendarDate
    let upcomingEvaluatedOn: CalendarDate
    let recentActivity: RecentActivityState
    let attention: SectionState<AttentionContent>
    let upcoming: SectionState<UpcomingContent>
}
