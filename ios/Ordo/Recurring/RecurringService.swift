import Foundation

/// Reads the recurring expenses and sends the frozen writes.
protocol RecurringService: Sendable {
    /// Both reads must succeed; otherwise nothing is returned.
    func load() async throws -> RecurringSnapshot
    /// The change-review read, independent of `load()`: either can fail alone.
    func loadChanges() async throws -> CommitmentChangesSnapshot
    /// Sends exactly the bytes of the write. Throws `APIError` for refusals and unknown outcomes.
    func perform(_ write: CommitmentWrite) async throws
}

/// Production implementation: every call is an authorized request through the session, so a `401`
/// refreshes once and runs the same closure again with the same bytes.
struct SessionRecurringService: RecurringService {
    let session: SessionManager
    let api: OrdoAPI

    func load() async throws -> RecurringSnapshot {
        let api = self.api
        let session = self.session
        async let candidateData = session.authorized { token in try await api.commitmentCandidates(accessToken: token.value) }
        async let commitmentData = session.authorized { token in try await api.commitments(accessToken: token.value) }
        let (candidatesRaw, commitmentsRaw) = try await (candidateData, commitmentData)
        do {
            let candidates = try CommitmentsValidation.parseCandidates(candidatesRaw)
            let commitments = try CommitmentsValidation.parseCommitments(commitmentsRaw)
            return RecurringSnapshot(candidates: candidates.candidates, dismissed: candidates.dismissed, commitments: commitments)
        } catch {
            throw RecurringReadError.malformed
        }
    }

    func loadChanges() async throws -> CommitmentChangesSnapshot {
        let api = self.api
        let data = try await session.authorized { token in try await api.commitmentChanges(accessToken: token.value) }
        do {
            return try CommitmentChangesValidation.parse(data)
        } catch {
            throw RecurringReadError.malformed
        }
    }


    func perform(_ write: CommitmentWrite) async throws {
        let api = self.api
        try await session.authorized { token in
            switch write.operation {
            case .confirm(_, let body): try await api.confirmCandidate(accessToken: token.value, body: body)
            case .dismiss(_, let body): try await api.dismissCandidate(accessToken: token.value, body: body)
            case .reconsider(_, let body): try await api.reconsiderCandidate(accessToken: token.value, body: body)
            case .change(_, _, _, let path, let body):
                try await api.decideCommitmentChange(accessToken: token.value, path: path, body: body)
            case .lifecycle(let id, _, let body):
                try await api.updateCommitmentLifecycle(accessToken: token.value, id: id, body: body)
            }
        }
    }
}
