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
}

enum SessionError: Error, Equatable, Sendable {
    /// There is no session (or it ended while the caller was waiting).
    case signedOut
    /// The new credential could not be stored, so sign-in was not completed.
    case storageFailed
}
