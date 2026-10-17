import Foundation

/// Failures the UI cares about. Only the `code` of an error body is ever read; `title` and
/// `detail` are never shown.
enum APIError: Error, Equatable, Sendable {
    case offline
    case invalidCredentials
    case emailNotConfirmed
    case sessionEnded
    case homeUnavailable
    case unauthorized
    case server(Int)
    case invalidResponse
    /// `400` on a create with at least one recognised field key. Only the keys are read.
    case validationFailed(Set<ValidationField>)
    /// `400` on a create with no recognised field key (for example `idempotency_key_invalid`).
    case createRejected
    /// `422 idempotency_key_reused`.
    case keyReused
    /// `409 idempotency_key_record_deleted`.
    case recordDeleted
    /// `409 idempotency_key_conflict`: a concurrent request; the outcome is not known.
    case conflict
}

/// A field named by a create validation error. Server messages are never read.
enum ValidationField: String, Sendable, Hashable {
    case amount, description, date, category
}

/// A successful create. `200` replays the record that the same key already created.
enum CreateResult: Equatable, Sendable {
    case created
    case replayed
}

enum SessionError: Error, Equatable, Sendable {
    /// There is no session (or it ended while the caller was waiting).
    case signedOut
    /// The new credential could not be stored, so sign-in was not completed.
    case storageFailed
}
