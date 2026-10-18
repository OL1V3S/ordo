import Foundation

/// One edit or delete, frozen at the first valid Save or Confirm. It is immutable, so a retry sends
/// exactly the same request. Descriptions, amounts and ids are never printed or logged.
struct MutationRequest: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Operation: Equatable, Sendable {
        case update(CaptureValidation.FrozenValues)
        case delete
    }

    let kind: CaptureKind
    let recordId: Int
    let operation: Operation

    var description: String { "MutationRequest(redacted)" }
    var debugDescription: String { description }

    var isDelete: Bool { operation == .delete }
}

/// A successful `PUT` or `DELETE`. `404` means the record is gone (missing, or another user's).
enum MutationResult: Equatable, Sendable {
    case applied
    case notFound
}
