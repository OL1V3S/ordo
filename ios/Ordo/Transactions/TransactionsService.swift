import Foundation

/// A timeline page that failed validation. The whole page is hidden, as on the web.
enum TimelineReadError: Error, Equatable, Sendable {
    case malformed
}

/// Reads the timeline and sends the frozen edits and deletes.
protocol TransactionsService: Sendable {
    func loadTimeline(_ query: TimelineQuery) async throws -> TimelinePage
    /// Sends exactly the values of the request. A repeat of the same request is safe: see
    /// `TransactionMutationViewModel`.
    func perform(_ request: MutationRequest) async throws -> MutationResult
}

/// Production implementation: every call is an authorized request through the session. A `401`
/// refreshes once (single flight) and runs the same closure again, so the same bytes are sent.
struct SessionTransactionsService: TransactionsService {
    let session: SessionManager
    let api: OrdoAPI

    func loadTimeline(_ query: TimelineQuery) async throws -> TimelinePage {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.activityTimeline(accessToken: token.value, query: query)
        }
        do { return try TimelineValidation.parse(data) } catch { throw TimelineReadError.malformed }
    }

    func perform(_ request: MutationRequest) async throws -> MutationResult {
        let api = self.api
        return try await session.authorized { token in
            switch (request.kind, request.operation) {
            case (.expense, .update(let values)):
                try await api.updateExpense(accessToken: token.value, id: request.recordId, values: values)
            case (.deposit, .update(let values)):
                try await api.updateInflow(accessToken: token.value, id: request.recordId, values: values)
            case (.expense, .delete):
                try await api.deleteExpense(accessToken: token.value, id: request.recordId)
            case (.deposit, .delete):
                try await api.deleteInflow(accessToken: token.value, id: request.recordId)
            }
        }
    }
}
