import Foundation

/// Reads one month of the cash-flow report. Read-only: nothing is written.
protocol ReportsService: Sendable {
    func loadCashFlow(month: BudgetMonth, throughDate: CalendarDate) async throws -> CashFlowReport
}

/// A response that failed validation or named another period. The whole response is hidden.
enum ReportsReadError: Error, Equatable, Sendable {
    case malformed
}

/// Production implementation: an authorized request through the session. A `401` refreshes once.
struct SessionReportsService: ReportsService {
    let session: SessionManager
    let api: OrdoAPI

    func loadCashFlow(month: BudgetMonth, throughDate: CalendarDate) async throws -> CashFlowReport {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.cashFlow(accessToken: token.value, month: month, throughDate: throughDate)
        }
        do { return try CashFlowValidation.parse(data, month: month, throughDate: throughDate) }
        catch { throw ReportsReadError.malformed }
    }
}
