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
    /// `400` on a timeline read, read from its `code` only.
    case timelineRejected(TimelineRejection)
    /// `503 activity_timeline_unavailable`.
    case timelineUnavailable
    /// `400` on an edit with no recognised field key (the id mismatch, or `request`). The earlier
    /// attempt may still have been applied, so the caller decides what to say.
    case updateRejected
    /// `400` on a budget limit upsert. The body is plain text or a ProblemDetails and is never read.
    case budgetRejected
    /// `400` on a paycheck write; only the `code` of the body is read.
    case paycheckRejected(String?)
    /// `404` with an empty body: the schedule is missing (or another owner's).
    case paycheckNotFound
    /// `409` on a paycheck write; only the `code` of the body is read. The server rolled back.
    case paycheckConflict(String?)
    /// `400` or `422` on a recurring-expense write; only the `code` of the body is read (a `422` has none used).
    case commitmentRejected(String?)
    /// `404 commitment_not_found`: the recurring expense is missing (or another owner's).
    case commitmentNotFound
    /// `409` on a recurring-expense write; only the `code` of the body is read. The server rolled back.
    case commitmentConflict(String?)
    /// A definitive `4xx` (other than `401`) on a statement import request. Only the status and the `code` of the body are read.
    case importRefused(status: Int, code: String?)
    /// `400` on a registration: the Identity `code` of each error, in server order. Descriptions are never read.
    case registrationRejected([IdentityCode])
    /// `503 confirmation_email_delivery_failed`: the account was created, the email was not sent.
    case confirmationDeliveryFailed
    /// A registration timed out or lost its connection: the account may or may not exist.
    case registrationOutcomeUnknown
    /// `429` from the resend, forgot-password or registration limiter.
    case rateLimited
}

/// Identity error codes the registration can return (the web's whitelist). Anything else is `.unknown`.
enum IdentityCode: String, Sendable, CaseIterable {
    case passwordTooShort = "PasswordTooShort"
    case passwordRequiresNonAlphanumeric = "PasswordRequiresNonAlphanumeric"
    case passwordRequiresDigit = "PasswordRequiresDigit"
    case passwordRequiresLower = "PasswordRequiresLower"
    case passwordRequiresUpper = "PasswordRequiresUpper"
    case passwordRequiresUniqueChars = "PasswordRequiresUniqueChars"
    case duplicateUserName = "DuplicateUserName"
    case duplicateEmail = "DuplicateEmail"
    case invalidEmail = "InvalidEmail"
    case invalidUserName = "InvalidUserName"
    case unknown = "?"

    init(code: String?) { self = code.flatMap(IdentityCode.init(rawValue:)) ?? .unknown }
}

/// A field named by a create or edit validation error. Server messages are never read.
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
