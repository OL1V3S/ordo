import Foundation

/// The Mark as ended confirmation for one missing-expense assessment.
struct ChangeEndTarget: Equatable, Sendable {
    let commitmentId: String
    let assessmentId: String
    let name: String
}

/// Builds the frozen write for a decision on a change, or nil when it is not offered right now.
enum ChangeWrites {
    static func make(_ decision: ChangeDecision, commitmentId: String, assessmentId: String,
                     in snapshot: CommitmentChangesSnapshot?) -> CommitmentWrite? {
        guard let change = snapshot?.change(id: commitmentId), let assessment = change.assessment(id: assessmentId),
              assessment.isActionable,
              let path = assessment.path(for: decision, commitmentId: commitmentId) else { return nil }
        return CommitmentWrite(operation: .change(commitmentId: commitmentId, dimension: assessment.dimension,
                                                  decision: decision, path: path,
                                                  body: CommitmentRequestBody.fingerprint(assessment.fingerprint)))
    }
}

extension RecurringViewModel {
    var pendingChanges: [CommitmentChange] { changes?.grouped(.pending) ?? [] }
    var reviewedChanges: [CommitmentChange] { changes?.grouped(.kept) ?? [] }
    var pendingChangeCount: Int { changes?.count(.pending) ?? 0 }
    var reviewedChangeCount: Int { changes?.count(.kept) ?? 0 }
    func change(id: String) -> CommitmentChange? { changes?.change(id: id) }
}
