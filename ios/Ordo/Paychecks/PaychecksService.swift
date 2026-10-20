import Foundation

/// Reads the paychecks and deposits and sends the frozen writes.
protocol PaychecksService: Sendable {
    func loadPaychecks() async throws -> PaychecksSnapshot
    func loadDeposits() async throws -> [SavedDeposit]
    /// Sends exactly the bytes of the write. Throws `APIError` for refusals and unknown outcomes.
    func perform(_ write: PaycheckWrite) async throws
}

/// Production implementation: every call is an authorized request through the session, so a `401`
/// refreshes once and runs the same closure again with the same bytes.
struct SessionPaychecksService: PaychecksService {
    let session: SessionManager
    let api: OrdoAPI

    func loadPaychecks() async throws -> PaychecksSnapshot {
        let api = self.api
        let data = try await session.authorized { token in try await api.paychecks(accessToken: token.value) }
        do { return try PaychecksValidation.parse(data) } catch { throw PaychecksReadError.malformed }
    }

    func loadDeposits() async throws -> [SavedDeposit] {
        let api = self.api
        let data = try await session.authorized { token in try await api.inflows(accessToken: token.value) }
        do { return try PaychecksValidation.parseDeposits(data) } catch { throw PaychecksReadError.malformed }
    }

    func perform(_ write: PaycheckWrite) async throws {
        let api = self.api
        try await session.authorized { token in
            switch write.operation {
            case .lifecycle(let id, _, let body):
                try await api.updatePaycheckLifecycle(accessToken: token.value, id: id, body: body)
            case .record(let id, let body):
                try await api.recordPaycheckReceipt(accessToken: token.value, id: id, body: body)
            case .removeReceipt(let id, let inflowId):
                try await api.removePaycheckReceipt(accessToken: token.value, id: id, inflowId: inflowId)
            }
        }
    }
}
