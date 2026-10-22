import Foundation

enum CommitmentLifecycle: String, Sendable, CaseIterable {
    case active, paused, ended
}

/// An amount read from the server; anything that is not an exact positive amount is "needs review".
typealias CommitmentMoney = PaycheckMoney

enum CommitmentAmount: Equatable, Sendable {
    case fixed(CommitmentMoney)
    case range(minimum: CommitmentMoney, maximum: CommitmentMoney)
    case unavailable
}

/// The expected (or observed) timing as the server sent it. Values stay as wire text so an unknown
/// value can be shown with the web's title fallback instead of being guessed.
struct CommitmentTiming: Equatable, Sendable {
    let cadence: String
    let kind: String
    let dayOfWeek: String?
    let day: Int?
    let month: Int?
    let windowBeforeDays: Int?
    let windowAfterDays: Int?
}

struct CommitmentEvidence: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let expenseId: Int
    let date: CalendarDate?
    let amount: CommitmentMoney
    let text: String
    let category: String
    let source: String

    var id: Int { expenseId }
    var description: String { "CommitmentEvidence(redacted)" }
    var debugDescription: String { description }
}

struct RecurringCandidate: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let fingerprint: String
    let name: String
    let category: String
    let timing: CommitmentTiming
    /// `true` when the server observed one identical amount.
    let observedFixed: Bool
    let median: CommitmentMoney
    let minimum: CommitmentMoney
    let maximum: CommitmentMoney
    let coveredFrom: CalendarDate?
    let coveredTo: CalendarDate?
    let occurrenceCount: Int
    let evidenceRule: String
    let evidence: [CommitmentEvidence]

    var id: String { fingerprint }
    var description: String { "RecurringCandidate(redacted)" }
    var debugDescription: String { description }
}

struct RecurringCommitment: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: String
    let name: String
    let category: String
    let lifecycle: CommitmentLifecycle
    let timing: CommitmentTiming
    let amount: CommitmentAmount
    let evidence: [CommitmentEvidence]

    var description: String { "RecurringCommitment(redacted)" }
    var debugDescription: String { description }
}

/// One successful pair of reads. The list is only ever replaced by a newer snapshot.
struct RecurringSnapshot: Equatable, Sendable {
    let candidates: [RecurringCandidate]
    let dismissed: [RecurringCandidate]
    let commitments: [RecurringCommitment]
}

/// One write, frozen at the first valid tap. Immutable, so a retry sends the same bytes.
struct CommitmentWrite: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Operation: Equatable, Sendable {
        case confirm(fingerprint: String, body: Data)
        case dismiss(fingerprint: String, body: Data)
        case reconsider(fingerprint: String, body: Data)
        case lifecycle(id: String, value: CommitmentLifecycle, body: Data)
        case change(commitmentId: String, dimension: ChangeDimension, decision: ChangeDecision, path: String, body: Data)

        var isChangeDecision: Bool {
            if case .change = self { return true }
            return false
        }
    }

    let operation: Operation
    var description: String { "CommitmentWrite(redacted)" }
    var debugDescription: String { description }
}

enum RecurringReadError: Error, Equatable, Sendable { case malformed }
