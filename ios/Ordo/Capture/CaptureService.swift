import Foundation

/// Sends one frozen save. Implementations must send exactly the values and key of the record.
protocol CaptureService: Sendable {
    func submit(_ save: PendingSave) async throws -> CreateResult
}

/// Production sender: an authorized request through the session. A 401 refreshes once
/// (single flight) and runs the same closure again, so the same key and bytes are sent.
struct SessionCaptureService: CaptureService {
    let session: SessionManager
    let api: OrdoAPI

    func submit(_ save: PendingSave) async throws -> CreateResult {
        let api = self.api
        return try await session.authorized { token in
            switch save.kind {
            case .expense:
                try await api.createExpense(accessToken: token.value, idempotencyKey: save.key,
                                            description: save.descriptionText, amount: save.amount,
                                            date: save.date, category: save.category ?? CaptureValidation.defaultCategory)
            case .deposit:
                try await api.createInflow(accessToken: token.value, idempotencyKey: save.key,
                                           description: save.descriptionText, amount: save.amount, date: save.date)
            }
        }
    }
}
