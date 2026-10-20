import Foundation
@testable import Ordo

/// Synthetic cash-flow JSON in the shape of the backend contract and the web's `testFixtures.js`.
enum ReportsFixtures {
    static let october = BudgetMonth(year: 2026, month: 10)!
    static let september = BudgetMonth(year: 2026, month: 9)!
    static let through = CalendarDate("2026-10-20")!
    /// 2026-10-20 12:00 UTC.
    static let now = Date(timeIntervalSince1970: 1_792_497_600)
    static let utc = TimeZone(secondsFromGMT: 0)!

    static func monthJSON(_ month: String = "2026-10", to: String = "2026-10-31", cashIn: String = "15000",
                          paycheck: String = "12000", other: String = "3000", spent: String = "10000",
                          net: String = "5000", counts: String = #""inflowCount":3,"paycheckInflowCount":2,"otherInflowCount":1,"expenseCount":2,"paycheckProfileCount":1,"editedPaycheckInflowCount":0"#) -> String {
        """
        {"month":"\(month)","from":"\(month)-01","to":"\(to)","cashInMinor":"\(cashIn)","paycheckCashInMinor":"\(paycheck)","otherCashInMinor":"\(other)","spentMinor":"\(spent)","netMinor":"\(net)",\(counts)}
        """
    }

    static func json(month: String = "2026-10", through: String = "2026-10-20", available: [String] = ["2026-10", "2026-09"],
                     selected: String? = nil, months: [String]? = nil,
                     categories: String = #"[{"category":"food","amountMinor":"9000"},{"category":"transport","amountMinor":"1000"}]"#,
                     extra: String = "") -> String {
        let bucket = selected ?? monthJSON(month, to: through)
        let list = (months ?? [bucket]).joined(separator: ",")
        return """
        {"month":"\(month)","throughDate":"\(through)","from":"\(month)-01","to":"\(through)","availableMonths":[\(available.map { "\"\($0)\"" }.joined(separator: ","))],"selected":\(bucket),"months":[\(list)],"categories":\(categories)\(extra)}
        """
    }

    static func data(_ text: String) -> Data { Data(text.utf8) }

    static func report(month: BudgetMonth = october, through: CalendarDate = ReportsFixtures.through,
                       available: [String] = ["2026-10", "2026-09"], cashIn: String = "15000") -> CashFlowReport {
        let text = json(month: month.key, through: through.isoString, available: available,
                        selected: monthJSON(month.key, cashIn: cashIn))
        return try! CashFlowValidation.parse(data(text), month: month, throughDate: through)
    }
}

final class ScriptedReportsService: ReportsService, @unchecked Sendable {
    typealias Handler = @Sendable (BudgetMonth, CalendarDate, Int) async throws -> CashFlowReport
    private let lock = NSLock()
    private var log: [(BudgetMonth, CalendarDate)] = []
    private let handler: Handler

    init(_ handler: @escaping Handler = { month, through, _ in ReportsFixtures.report(month: month, through: through) }) {
        self.handler = handler
    }

    var requests: [(month: BudgetMonth, throughDate: CalendarDate)] {
        lock.lock(); defer { lock.unlock() }
        return log.map { (month: $0.0, throughDate: $0.1) }
    }

    private func record(_ month: BudgetMonth, _ through: CalendarDate) -> Int {
        lock.lock(); defer { lock.unlock() }
        log.append((month, through))
        return log.count
    }

    func loadCashFlow(month: BudgetMonth, throughDate: CalendarDate) async throws -> CashFlowReport {
        let index = record(month, throughDate)
        return try await handler(month, throughDate, index)
    }
}

@MainActor enum ReportsModelFactory {
    static func make(_ service: ScriptedReportsService = ScriptedReportsService()) -> ReportsViewModel {
        ReportsViewModel(service: service, now: { ReportsFixtures.now }, timeZone: { ReportsFixtures.utc })
    }
}
