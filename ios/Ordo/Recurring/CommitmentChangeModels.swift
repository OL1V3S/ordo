import Foundation

/// What the server noticed about a recurring expense: a new amount, new dates, or no matching expense.
enum ChangeDimension: String, Sendable, CaseIterable, Hashable {
    case amount, timing, missing
}

/// The owner's decision on one exact proposal. Anything else is not shown.
enum ChangeDecisionState: String, Sendable {
    case pending, kept
}

enum MissingState: String, Sendable {
    case notSeenRecently = "not_seen_recently"
    case possiblyEnded = "possibly_ended"
}

/// The five decisions (web: accept amount, accept timing, mark ended, keep, review again).
enum ChangeDecision: Equatable, Sendable {
    case accept, keep, markEnded, reconsider
}

/// What an assessment proposes. Proposed amounts are exact two-decimal strings; anything else is
/// `.unavailable`. A timing proposal reuses the saved cadence (the server does not propose one).
enum ChangeProposal: Equatable, Sendable {
    case amount(CommitmentAmount)
    case timing(CommitmentTiming)
    case missing(state: MissingState, missedDates: [CalendarDate?])
}

/// One actionable assessment: a valid fingerprint, a proposal and a decision state.
struct ChangeAssessment: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let dimension: ChangeDimension
    let fingerprint: String
    let decision: ChangeDecisionState
    let proposal: ChangeProposal
    /// Observations the server cites for an amount or timing proposal, in observation order.
    let evidence: [CommitmentEvidence]
    /// Amount proposals only (always true otherwise): the proposed value(s) and every cited
    /// observation amount are exact, so a decision can be made on them.
    let isExact: Bool

    var id: String { "\(dimension.rawValue):\(fingerprint)" }
    var description: String { "ChangeAssessment(redacted)" }
    var debugDescription: String { description }

    /// The decisions this state offers (web `ChangeActions`; the server answers 409 otherwise).
    var decisions: [ChangeDecision] {
        switch (decision, dimension, proposal) {
        case (.kept, _, _): return [.reconsider]
        case (.pending, .amount, _), (.pending, .timing, _): return [.accept, .keep]
        case (.pending, .missing, .missing(.possiblyEnded, _)): return [.markEnded, .keep]
        case (.pending, .missing, _): return [.keep]
        }
    }

    /// Whether any decision may be made: an amount assessment that is not exact offers none.
    var isActionable: Bool { isExact }

    /// The path of a decision on this assessment, or nil for a combination the server has no endpoint for.
    func path(for choice: ChangeDecision, commitmentId: String) -> String? {
        guard decisions.contains(choice) else { return nil }
        return CommitmentChangePath.path(commitmentId: commitmentId, dimension: dimension, decision: choice)
    }
}

/// The saved details of the recurring expense a change is about.
struct ChangeCommitment: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: String
    let name: String
    let category: String
    let timing: CommitmentTiming
    let amount: CommitmentAmount

    var description: String { "ChangeCommitment(redacted)" }
    var debugDescription: String { description }
}

struct CommitmentChange: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let commitment: ChangeCommitment
    let algorithmVersion: String
    /// Pending and kept assessments with a valid fingerprint, in amount, timing, missing order.
    let assessments: [ChangeAssessment]

    var id: String { commitment.id }
    var description: String { "CommitmentChange(redacted)" }
    var debugDescription: String { description }

    func assessment(id: String) -> ChangeAssessment? { assessments.first { $0.id == id } }
}

/// One successful read of `GET /api/commitment-changes`.
struct CommitmentChangesSnapshot: Equatable, Sendable {
    let evaluatedOn: CalendarDate?
    let changes: [CommitmentChange]

    /// The web's `groupCommitmentChanges`: commitments with at least one assessment in this state,
    /// each carrying only those assessments.
    func grouped(_ state: ChangeDecisionState) -> [CommitmentChange] {
        changes.compactMap { change in
            let kept = change.assessments.filter { $0.decision == state }
            return kept.isEmpty ? nil : CommitmentChange(commitment: change.commitment,
                                                         algorithmVersion: change.algorithmVersion, assessments: kept)
        }
    }

    func count(_ state: ChangeDecisionState) -> Int {
        changes.reduce(0) { $0 + $1.assessments.filter { $0.decision == state }.count }
    }

    func change(id: String) -> CommitmentChange? { changes.first { $0.id == id } }
}

enum CommitmentChangePath {
    /// `api/commitment-changes/{id}/...`. Accept exists for amount and timing, mark-ended for missing.
    static func path(commitmentId: String, dimension: ChangeDimension, decision: ChangeDecision) -> String? {
        let base = "api/commitment-changes/\(commitmentId)"
        switch (decision, dimension) {
        case (.accept, .amount): return "\(base)/amount/accept"
        case (.accept, .timing): return "\(base)/timing/accept"
        case (.markEnded, .missing): return "\(base)/missing/mark-ended"
        case (.keep, _): return "\(base)/\(dimension.rawValue)/keep"
        case (.reconsider, _): return "\(base)/\(dimension.rawValue)/reconsider"
        default: return nil
        }
    }
}
