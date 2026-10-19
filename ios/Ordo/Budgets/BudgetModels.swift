import Foundation

/// A category compared by its exact Unicode scalars: no trimming, case folding, aliasing or
/// canonical-equivalence matching. Swift `String ==` treats a precomposed and a decomposed `é` as
/// equal, but the server (ordinal) and the web (JavaScript) do not, so rows and totals are keyed by
/// scalars and never by `String`.
struct ExactCategoryKey: Hashable, Sendable {
    let scalars: [Unicode.Scalar]

    init(_ category: String) { scalars = Array(category.unicodeScalars) }
}

enum BudgetCategory {
    /// Null, empty or whitespace only, as .NET `string.IsNullOrWhiteSpace` and the invariant's
    /// "blank" (both use the Unicode White_Space set).
    static func isBlank(_ category: String) -> Bool {
        category.unicodeScalars.allSatisfy { $0.properties.isWhitespace }
    }
}

/// What a limit row shows for its limit. A stored `limitAmount` that is not a JSON number inside
/// the exact range (a string, a negative, three decimals, 2^46 dollars or more) is never repaired:
/// it degrades only that row to "Exact limit unavailable".
enum BudgetLimitValue: Equatable, Sendable {
    case exact(Money)
    case needsReview
}

/// One row of `GET /api/budgetlimits`. The owner id the server returns is never decoded, stored,
/// shown, logged or sent. Categories, amounts and ids are never printed or logged.
struct BudgetLimitRow: Equatable, Sendable, Identifiable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: Int
    /// The stored category, exactly as the server returned it.
    let category: String
    let limit: BudgetLimitValue

    var key: ExactCategoryKey { ExactCategoryKey(category) }
    /// A row whose stored category is blank can only be deleted: the server would answer `400` to
    /// an upsert for it.
    var isBlankCategory: Bool { BudgetCategory.isBlank(category) }

    var description: String { "BudgetLimitRow(redacted)" }
    var debugDescription: String { description }
}

/// The category choices of the Add form, as on the web's budget form: a "Category" placeholder
/// with no default, then these. `other` reveals the custom text field; there is no "Uncategorized".
enum BudgetCategoryChoice: String, CaseIterable, Sendable {
    case food, transport, bills, entertainment, other

    var labelKey: L10nKey {
        switch self {
        case .food: .categoryFood
        case .transport: .categoryTransport
        case .bills: .categoryBills
        case .entertainment: .categoryEntertainment
        case .other: .categoryOther
        }
    }
}

/// What the user is typing in the budget form. The choice is nil until one is picked.
struct BudgetDraft: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    var choice: BudgetCategoryChoice?
    var customCategory = ""
    var amountText = ""

    var description: String { "BudgetDraft(redacted)" }
    var debugDescription: String { description }
}

/// Form fields in the order the form shows them (the first invalid one gets focus).
enum BudgetField: Int, Comparable, Sendable {
    case category, customCategory, amount

    static func < (lhs: BudgetField, rhs: BudgetField) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// The values an upsert sends: the category, the limit and the month, nothing else. No `id`,
/// `userId` or `user` is ever sent. Categories and amounts are never printed or logged.
struct BudgetUpsert: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let category: String
    let limit: Money
    let month: BudgetMonth

    var description: String { "BudgetUpsert(redacted)" }
    var debugDescription: String { description }

    /// Deterministic bytes with the keys in sorted order:
    /// `{"category":<JSON string>,"limitAmount":<Money.text>,"monthYear":"YYYY-MM-01"}`.
    ///
    /// The limit is written as a JSON number whose text is exactly `Money.text` (it matches
    /// `^(0|[1-9]\d*)\.\d{2}$`, a valid JSON number), so the server reads the same cents and no
    /// `Decimal` or `Double` encoder is involved. The category string is escaped by `JSONEncoder`.
    func requestBody() throws -> Data {
        var body = Data("{\"category\":".utf8)
        body.append(try JSONEncoder().encode(category))
        body.append(Data(",\"limitAmount\":\(limit.text),\"monthYear\":\"\(month.monthYearWireValue)\"}".utf8))
        return body
    }
}

/// One add, edit or delete, frozen at the first valid Save or Confirm. It is immutable, so every
/// attempt sends exactly the same request.
struct BudgetWrite: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Operation: Equatable, Sendable {
        case upsert(BudgetUpsert)
        case delete(id: Int)
    }

    let operation: Operation

    var isDelete: Bool {
        if case .delete = operation { return true }
        return false
    }

    var description: String { "BudgetWrite(redacted)" }
    var debugDescription: String { description }
}

/// The card status, in the order the web checks them.
enum BudgetStatus: CaseIterable, Sendable {
    case spendingUnavailable
    case spendingNeedsReview
    case limitNeedsReview
    case zeroLimit
    case overLimit
    case limitReached
    case nearLimit
    case withinLimit

    var labelKey: L10nKey {
        switch self {
        case .spendingUnavailable: .budgetsCardStatusSpendingUnavailable
        case .spendingNeedsReview: .budgetsCardStatusSpendingNeedsReview
        case .limitNeedsReview: .budgetsCardStatusLimitNeedsReview
        case .zeroLimit: .budgetsCardStatusZeroLimit
        case .overLimit: .budgetsCardStatusOverLimit
        case .limitReached: .budgetsCardStatusLimitReached
        case .nearLimit: .budgetsCardStatusNearLimit
        case .withinLimit: .budgetsCardStatusWithinLimit
        }
    }
}

/// Recorded spending for one month, per exact category, in integer cents. Totals, categories and
/// amounts are never printed or logged.
struct BudgetSpending: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Total: Equatable, Sendable {
        case cents(Int64)
        /// An expense amount that cannot be read exactly (a zero or negative stored amount, or a
        /// total above the maximum) makes only that category's spending unavailable.
        case needsReview
    }

    let totals: [ExactCategoryKey: Total]
    /// An expense in the evaluated range has a blank or whitespace-only category. It is never
    /// aliased to "Uncategorized" and never omitted: no row's spending can be trusted for the month.
    let hasBlankCategoryExpense: Bool

    static let empty = BudgetSpending(totals: [:], hasBlankCategoryExpense: false)

    /// What a row compares against its limit: `0.00` when the category has no expenses.
    func total(for category: String) -> Total {
        if hasBlankCategoryExpense || BudgetCategory.isBlank(category) { return .needsReview }
        return totals[ExactCategoryKey(category)] ?? .cents(0)
    }

    var description: String { "BudgetSpending(redacted)" }
    var debugDescription: String { description }
}
