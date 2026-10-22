import Foundation
import Testing
@testable import Ordo

@MainActor @Suite struct RecurringChangesViewModelTests {
    private let id = ChangeFixtures.id
    private var amountOnly: CommitmentChangesSnapshot { get throws { try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON()) } }
    private var empty: CommitmentChangesSnapshot { CommitmentChangesSnapshot(evaluatedOn: CalendarDate("2026-10-01"), changes: []) }

    private func setup(snapshot: CommitmentChangesSnapshot, performs: [ScriptedRecurringService.Perform] = [{ _ in }],
                       other: @escaping @MainActor () -> Bool = { false },
                       home: Counter = Counter()) async -> (RecurringViewModel, ScriptedRecurringService) {
        let service = ScriptedRecurringService(performs: performs, changes: [{ snapshot }])
        let model = await RecurringFixtures.loaded(service, refreshOthers: { _ = home.next() }, other: other)
        return (model, service)
    }

    private func aid(_ model: RecurringViewModel, _ index: Int = 0) -> String { model.pendingChanges[0].assessments[index].id }

    private func bytes(_ write: CommitmentWrite) -> String {
        guard case .change(_, _, _, _, let body) = write.operation else { return "" }
        return String(decoding: body, as: UTF8.self)
    }

    @Test func acceptSendsOnlyTheFingerprintAndReadsEverythingAgain() async throws {
        let home = Counter()
        let (model, service) = try await setup(snapshot: amountOnly, home: home)
        let (reads, changeReads) = (service.loadCount, service.changeLoadCount)
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        #expect(model.writePhase == .submitting)
        await model.settled()
        #expect(service.writes.count == 1 && bytes(service.writes[0]) == #"{"fingerprint":"\#(ChangeFixtures.fp)"}"#)
        guard case .change(let target, let dimension, let decision, let path, _) = service.writes[0].operation else { Issue.record("not a change"); return }
        #expect(target == id && dimension == .amount && decision == .accept && path == "api/commitment-changes/\(id)/amount/accept")
        #expect(model.notice == .amountAccepted && model.writePhase == .idle)
        #expect(service.loadCount == reads + 1 && service.changeLoadCount == changeReads + 1 && home.next() == 2)
    }

    @Test func noticesFollowTheDecision() async throws {
        let cases: [(String, String, ChangeDecision, RecurringViewModel.Notice)] = [
            (ChangeFixtures.amountJSON(), "amount", .keep, .keptCurrent),
            (ChangeFixtures.amountJSON(decision: "kept"), "amount", .reconsider, .changeReconsidered)]
        for (json, _, decision, notice) in cases {
            let (model, _) = try await setup(snapshot: ChangeFixtures.snapshot(amount: json))
            let change = try #require((model.pendingChanges + model.reviewedChanges).first)
            model.decide(decision, commitmentId: change.id, assessmentId: change.assessments[0].id)
            await model.settled()
            #expect(model.notice == notice)
        }
        let (missing, _) = try await setup(snapshot: ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON("not_seen_recently")))
        missing.decide(.keep, commitmentId: id, assessmentId: aid(missing))
        await missing.settled()
        #expect(missing.notice == .keptActive && missing.expanded.contains(.reviewedChanges))
    }

    @Test func offeredDecisionsOnlyAreSent() async throws {
        let (model, service) = try await setup(snapshot: ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON("not_seen_recently")))
        model.decide(.markEnded, commitmentId: id, assessmentId: aid(model))
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        model.decide(.reconsider, commitmentId: id, assessmentId: aid(model))
        #expect(service.writes.isEmpty && model.changeEndTarget == nil)
    }

    @Test func aNonExactAmountAllowsNoDecision() async throws {
        let snapshot = try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(amount: "12.345"))
        let (model, service) = await setup(snapshot: snapshot)
        for decision in [ChangeDecision.accept, .keep, .reconsider] { model.decide(decision, commitmentId: id, assessmentId: aid(model)) }
        #expect(service.writes.isEmpty)
        let kept = try await setup(snapshot: ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(decision: "kept", amount: "12.345")))
        kept.0.decide(.reconsider, commitmentId: id, assessmentId: kept.0.reviewedChanges[0].assessments[0].id)
        #expect(kept.1.writes.isEmpty)
    }

    @Test func markEndedNeedsTheConfirmationAndActsOnThePresentedChange() async throws {
        let (model, service) = try await setup(snapshot: ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON()))
        model.decide(.markEnded, commitmentId: id, assessmentId: aid(model))
        let target = try #require(model.changeEndTarget)
        #expect(service.writes.isEmpty && target.name == "Synthetic Rent")
        model.cancelChangeEnd()
        #expect(model.changeEndTarget == nil && service.writes.isEmpty)
        model.decide(.markEnded, commitmentId: id, assessmentId: aid(model))
        model.confirmChangeEnd(target)
        await model.settled()
        guard case .change(_, .missing, .markEnded, let path, _) = service.writes[0].operation else { Issue.record("wrong write"); return }
        #expect(path == "api/commitment-changes/\(id)/missing/mark-ended" && model.notice == .markedEnded && model.expanded.contains(.ended))
    }

    @Test func theConfirmationClosesWhenTheChangeDisappears() async throws {
        let service = ScriptedRecurringService(changes: [{ try ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON()) }])
        let model = await RecurringFixtures.loaded(service)
        model.decide(.markEnded, commitmentId: id, assessmentId: aid(model))
        #expect(model.changeEndTarget != nil)
        service.setChanges([{ CommitmentChangesSnapshot(evaluatedOn: nil, changes: []) }])
        await model.refresh()
        #expect(model.changeEndTarget == nil)
    }

    @Test func aStaleProposalShowsTheNoticeAndReadsAgainWithoutRetrying() async throws {
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in throw APIError.commitmentConflict("change_proposal_changed") }])
        let reads = service.changeLoadCount
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        #expect(model.notice == .error("change_proposal_changed") && model.writePhase == .idle)
        #expect(service.writes.count == 1 && service.changeLoadCount == reads + 1)
    }

    @Test func aNotFoundReadsAgain() async throws {
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in throw APIError.commitmentNotFound }])
        let reads = service.changeLoadCount
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        #expect(model.notice == .error("commitment_not_found") && service.changeLoadCount == reads + 1)
    }

    @Test(arguments: [APIError.commitmentRejected("fingerprint_invalid"), .commitmentRejected("dimension_invalid"), .commitmentRejected(nil),
                      .commitmentConflict("candidate_changed")])
    func otherRefusalsShowAnErrorAndChangeNothing(error: APIError) async throws {
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in throw error }])
        let (reads, changeReads) = (service.loadCount, service.changeLoadCount)
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        guard case .error? = model.notice else { Issue.record("no error notice"); return }
        #expect(model.writePhase == .idle && service.loadCount == reads && service.changeLoadCount == changeReads)
        #expect(model.pendingChanges.count == 1)
    }

    @Test func uncertainThenRetrySendsTheIdenticalBytes() async throws {
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in throw APIError.offline }, { _ in }])
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        #expect(model.writePhase == .uncertain && !model.canDecideChanges)
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        #expect(service.writes.count == 1)
        model.retry()
        await model.settled()
        #expect(service.writes.count == 2 && service.writes[0] == service.writes[1] && model.notice == .amountAccepted)
    }

    @Test func aConflictOnRetryForcesACheckAndShowsNoProposalChangedNotice() async throws {
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in throw APIError.offline },
                                                                                  { _ in throw APIError.commitmentConflict("change_proposal_changed") }])
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .uncertain && !model.canRetry && model.notice == nil)
        #expect(RecurringPresenter.retryConflictKey("change_proposal_changed") == nil)
        #expect(RecurringPresenter.retryConflictKey("candidate_changed") == .commitmentsFeedbackErrorsCandidateChanged)
        model.retry()
        #expect(service.writes.count == 2)
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked)
    }

    @Test func aKeepRetryAnswered204IsSuccess() async throws {
        let (model, _) = try await setup(snapshot: amountOnly, performs: [{ _ in throw APIError.server(503) }, { _ in }])
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .idle && model.notice == .keptCurrent)
    }

    @Test func checkNeedsTheChangesReadForAChangeDecision() async throws {
        let service = ScriptedRecurringService(performs: [{ _ in throw APIError.offline }], changes: [{ try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON()) }])
        let model = await RecurringFixtures.loaded(service)
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        await model.settled()
        service.setChanges([{ throw APIError.offline }])
        await model.check()
        #expect(model.writePhase == .uncertain)
        service.setChanges([{ try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(decision: "kept")) }])
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked && model.reviewedChanges.count == 1)
    }

    @Test func oneWriteAtATime() async throws {
        let gate = Gate()
        let (model, service) = try await setup(snapshot: amountOnly, performs: [{ _ in await gate.wait() }])
        model.decide(.keep, commitmentId: id, assessmentId: aid(model))
        model.decide(.accept, commitmentId: id, assessmentId: aid(model))
        await gate.release()
        await model.settled()
        #expect(service.writes.count == 1)
        let flag = FlagBox()
        flag.on = true
        let (blocked, other) = try await setup(snapshot: amountOnly, other: { flag.on })
        blocked.decide(.keep, commitmentId: id, assessmentId: aid(blocked))
        #expect(other.writes.isEmpty)
    }

    @Test func aFailedChangesReadAloneKeepsTheListAndDisablesDecisions() async throws {
        let service = ScriptedRecurringService(changes: [{ throw APIError.offline }])
        let model = await RecurringFixtures.loaded(service)
        #expect(model.listState == .loaded && model.snapshot != nil && model.changesFailed && model.changes == nil)
        #expect(!model.canDecideChanges && model.canWrite)
        model.decide(.keep, commitmentId: id, assessmentId: "amount:\(ChangeFixtures.fp)")
        #expect(service.writes.isEmpty)
        service.setChanges([{ try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON()) }])
        await model.refresh()
        #expect(!model.changesFailed && model.canDecideChanges && model.pendingChangeCount == 1)
    }

    @Test func aMalformedChangesReadIsAFailureOfThatReadOnly() async throws {
        let service = ScriptedRecurringService(changes: [{ throw RecurringReadError.malformed }])
        let model = await RecurringFixtures.loaded(service)
        #expect(model.listState == .loaded && model.changesFailed)
    }

    @Test func aFailedListsReadHidesTheChangesToo() async throws {
        let service = ScriptedRecurringService(loads: [{ throw APIError.offline }], changes: [{ try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON()) }])
        let model = await RecurringFixtures.loaded(service)
        #expect(model.listState == .failed && model.changes == nil && !model.canDecideChanges)
    }

    @Test func resetDropsTheChanges() async throws {
        let (model, _) = try await setup(snapshot: amountOnly)
        #expect(model.pendingChangeCount == 1)
        model.reset()
        #expect(model.changes == nil && model.pendingChangeCount == 0 && model.changeEndTarget == nil)
    }
}

@MainActor private final class FlagBox { var on = false }
