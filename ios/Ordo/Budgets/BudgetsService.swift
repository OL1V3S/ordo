import Foundation

/// A budget-limits response that failed validation. The whole response is hidden.
enum BudgetReadError: Error, Equatable, Sendable {
    case malformed
}

/// Reads one month's limits and spending, and sends the frozen upserts and deletes.
protocol BudgetsService: Sendable {
    func loadLimits(month: BudgetMonth) async throws -> [BudgetLimitRow]
    /// One page of the expense timeline, for the month's recorded spending.
    func loadTimelinePage(_ query: TimelineQuery) async throws -> TimelinePage
    /// Sends exactly the values of the write. A repeat of the same write is safe: see
    /// `BudgetsViewModel`.
    func perform(_ write: BudgetWrite) async throws -> MutationResult
}

/// Production implementation: every call is an authorized request through the session. A `401`
/// refreshes once (single flight) and runs the same closure again, so the same bytes are sent.
struct SessionBudgetsService: BudgetsService {
    let session: SessionManager
    let api: OrdoAPI

    func loadLimits(month: BudgetMonth) async throws -> [BudgetLimitRow] {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.budgetLimits(accessToken: token.value, month: month)
        }
        do { return try BudgetLimitsValidation.parse(data, month: month) } catch { throw BudgetReadError.malformed }
    }

    func loadTimelinePage(_ query: TimelineQuery) async throws -> TimelinePage {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.activityTimeline(accessToken: token.value, query: query)
        }
        do { return try TimelineValidation.parse(data) } catch { throw TimelineReadError.malformed }
    }

    func perform(_ write: BudgetWrite) async throws -> MutationResult {
        let api = self.api
        return try await session.authorized { token in
            switch write.operation {
            case .upsert(let upsert):
                try await api.upsertBudgetLimit(accessToken: token.value, upsert)
            case .delete(let id):
                try await api.deleteBudgetLimit(accessToken: token.value, id: id)
            }
        }
    }
}
