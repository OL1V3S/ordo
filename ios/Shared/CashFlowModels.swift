import Foundation

/// One calendar month of the cash-flow report, exactly as the server sent it.
struct CashFlowMonth: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let month: BudgetMonth
    let from: CalendarDate
    let to: CalendarDate
    let cashIn: CashAmount
    let paycheckCashIn: CashAmount
    let otherCashIn: CashAmount
    let spent: CashAmount
    let net: CashAmount
    let inflowCount: Int
    let paycheckInflowCount: Int
    let otherInflowCount: Int
    let expenseCount: Int
    let paycheckProfileCount: Int
    let editedPaycheckInflowCount: Int

    var description: String { "CashFlowMonth(redacted)" }
    var debugDescription: String { "CashFlowMonth(redacted)" }
}

struct CashFlowCategory: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    /// The raw stored category.
    let category: String
    let amount: CashAmount

    var description: String { "CashFlowCategory(redacted)" }
    var debugDescription: String { "CashFlowCategory(redacted)" }
}

struct CashFlowReport: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let month: BudgetMonth
    let throughDate: CalendarDate
    let from: CalendarDate
    let to: CalendarDate
    /// Newest first, as the server sent them.
    let availableMonths: [BudgetMonth]
    let selected: CashFlowMonth
    let months: [CashFlowMonth]
    let categories: [CashFlowCategory]

    var description: String { "CashFlowReport(redacted)" }
    var debugDescription: String { "CashFlowReport(redacted)" }
}
