import Foundation

enum CashFlowValidationError: Error, Equatable {
    case malformed
}

/// Parses the cash-flow response. Every amount and date is declared as a string and every count as
/// an `Int`, so no JSON number is ever decoded into a `Double`. Anything malformed, or a response
/// for another period than the one asked for, fails as a whole: no partial report is shown.
enum CashFlowValidation {
    private struct RawMonth: Decodable {
        let month: String, from: String, to: String
        let cashInMinor: String, paycheckCashInMinor: String, otherCashInMinor: String
        let spentMinor: String, netMinor: String
        let inflowCount: Int, paycheckInflowCount: Int, otherInflowCount: Int, expenseCount: Int
        let paycheckProfileCount: Int, editedPaycheckInflowCount: Int
    }

    private struct RawCategory: Decodable {
        let category: String
        let amountMinor: String
    }

    private struct RawReport: Decodable {
        let month: String, throughDate: String, from: String, to: String
        let availableMonths: [String]
        let selected: RawMonth
        let months: [RawMonth]
        let categories: [RawCategory]
    }

    static func parse(_ data: Data, month requested: BudgetMonth, throughDate requestedDate: CalendarDate) throws -> CashFlowReport {
        guard let raw = try? JSONDecoder().decode(RawReport.self, from: data),
              let month = BudgetMonth(key: raw.month), month == requested,
              let throughDate = CalendarDate(raw.throughDate), throughDate == requestedDate,
              let from = CalendarDate(raw.from), let to = CalendarDate(raw.to),
              let selected = convert(raw.selected), selected.month == month,
              !raw.months.isEmpty else { throw CashFlowValidationError.malformed }
        var available: [BudgetMonth] = []
        for key in raw.availableMonths {
            guard let value = BudgetMonth(key: key) else { throw CashFlowValidationError.malformed }
            available.append(value)
        }
        var months: [CashFlowMonth] = []
        for entry in raw.months {
            guard let value = convert(entry) else { throw CashFlowValidationError.malformed }
            months.append(value)
        }
        var categories: [CashFlowCategory] = []
        for entry in raw.categories {
            guard let amount = CashAmount(entry.amountMinor) else { throw CashFlowValidationError.malformed }
            categories.append(CashFlowCategory(category: entry.category, amount: amount))
        }
        return CashFlowReport(month: month, throughDate: throughDate, from: from, to: to, availableMonths: available,
                              selected: selected, months: months, categories: categories)
    }

    private static func convert(_ raw: RawMonth) -> CashFlowMonth? {
        guard let month = BudgetMonth(key: raw.month), let from = CalendarDate(raw.from), let to = CalendarDate(raw.to),
              let cashIn = CashAmount(raw.cashInMinor), let paycheck = CashAmount(raw.paycheckCashInMinor),
              let other = CashAmount(raw.otherCashInMinor), let spent = CashAmount(raw.spentMinor),
              let net = CashAmount(raw.netMinor),
              [raw.inflowCount, raw.paycheckInflowCount, raw.otherInflowCount, raw.expenseCount,
               raw.paycheckProfileCount, raw.editedPaycheckInflowCount].allSatisfy({ $0 >= 0 }) else { return nil }
        return CashFlowMonth(month: month, from: from, to: to, cashIn: cashIn, paycheckCashIn: paycheck,
                             otherCashIn: other, spent: spent, net: net, inflowCount: raw.inflowCount,
                             paycheckInflowCount: raw.paycheckInflowCount, otherInflowCount: raw.otherInflowCount,
                             expenseCount: raw.expenseCount, paycheckProfileCount: raw.paycheckProfileCount,
                             editedPaycheckInflowCount: raw.editedPaycheckInflowCount)
    }
}
