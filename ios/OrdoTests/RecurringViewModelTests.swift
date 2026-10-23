import Foundation
import Testing
@testable import Ordo

@MainActor @Suite struct RecurringViewModelTests {
    private let active = RecurringFixtures.commitment()
    private let candidate = RecurringFixtures.candidate()

    private func setup(performs: [ScriptedRecurringService.Perform] = [{ _ in }],
                       loads: [ScriptedRecurringService.Load] = [{ RecurringFixtures.snapshot() }], home: Counter = Counter(),
                       other: @escaping @MainActor () -> Bool = { false }) async -> (RecurringViewModel, ScriptedRecurringService) {
        let service = ScriptedRecurringService(loads: loads, performs: performs)
        let model = await RecurringFixtures.loaded(service, refreshOthers: { _ = home.next() }, other: other)
        return (model, service)
    }

    private func bodyText(_ write: CommitmentWrite) -> String {
        switch write.operation {
        case .confirm(_, let body), .dismiss(_, let body), .reconsider(_, let body), .lifecycle(_, _, let body),
             .update(_, let body), .change(_, _, _, _, let body):
            String(decoding: body, as: UTF8.self)
        }
    }

    @Test func endNeedsConfirmationButPauseDismissAndReactivateDoNot() async {
        let (model, service) = await setup()
        model.perform(.end, on: active)
        await model.settled()
        #expect(service.writes.isEmpty && model.endTarget == active)
        model.cancelEnd()
        model.perform(.pause, on: active)
        await model.settled()
        #expect(service.writes.count == 1 && bodyText(service.writes[0]) == #"{"lifecycle":"paused"}"#)
        model.dismiss(candidate)
        await model.settled()
        #expect(service.writes.count == 2 && bodyText(service.writes[1]) == #"{"fingerprint":"\#(RecurringFixtures.fp1)"}"#)
        model.confirmEnd(active)
        await model.settled()
        #expect(service.writes.count == 3 && bodyText(service.writes[2]) == #"{"lifecycle":"ended"}"#)
    }

    @Test func endActsOnThePresentedCommitment() async {
        let other = RecurringFixtures.commitment(RecurringFixtures.id2, name: "Other")
        let (model, service) = await setup(loads: [{ RecurringFixtures.snapshot(commitments: [RecurringFixtures.commitment(), other]) }])
        model.perform(.end, on: active)
        model.confirmEnd(active)
        await model.settled()
        guard case .lifecycle(let id, .ended, _) = service.writes[0].operation else { Issue.record("wrong write"); return }
        #expect(id == active.id && model.endTarget == nil)
    }

    @Test func theEndDialogClosesWhenTheCommitmentChangesUnderneathIt() async {
        let paused = RecurringFixtures.snapshot(commitments: [RecurringFixtures.commitment(lifecycle: .paused)])
        let (model, _) = await setup(loads: [{ RecurringFixtures.snapshot() }, { paused }, { RecurringFixtures.snapshot(commitments: []) }])
        model.perform(.end, on: active)
        #expect(model.endTarget == active)
        await model.refresh()
        #expect(model.endTarget == nil)
        model.perform(.reactivate, on: RecurringFixtures.commitment(lifecycle: .paused))
        await model.settled()
        let (gone, _) = await setup(loads: [{ RecurringFixtures.snapshot() }, { RecurringFixtures.snapshot(commitments: []) }])
        gone.perform(.end, on: active)
        await gone.refresh()
        #expect(gone.endTarget == nil)
    }

    @Test func theEndDialogStaysWhenNothingChanged() async {
        let (model, _) = await setup()
        model.perform(.end, on: active)
        await model.refresh()
        #expect(model.endTarget == active)
    }

    @Test func twoRapidTapsSendOneRequest() async {
        let gate = Gate()
        let (model, service) = await setup(performs: [{ _ in await gate.wait() }])
        model.perform(.pause, on: active)
        model.perform(.pause, on: active)
        #expect(model.writePhase == .submitting)
        await gate.release()
        await model.settled()
        #expect(service.writes.count == 1)
    }

    @Test func anAppliedWriteReadsEverythingAgainOnceWithNoLocalChange() async {
        let home = Counter()
        let paused = RecurringFixtures.snapshot(commitments: [RecurringFixtures.commitment(lifecycle: .paused)])
        let (model, service) = await setup(loads: [{ RecurringFixtures.snapshot() }, { paused }], home: home)
        let before = service.loadCount
        let gate = Gate()
        service.setPerforms([{ _ in await gate.wait() }])
        model.perform(.pause, on: active)
        #expect(model.snapshot?.commitments[0].lifecycle == .active)
        await gate.release()
        await model.settled()
        #expect(service.loadCount == before + 1 && home.next() == 2)
        #expect(model.snapshot?.commitments[0].lifecycle == .paused && model.notice == .lifecycle && model.expanded.contains(.paused))
    }

    @Test func dismissAndReconsiderNoticesAndGroups() async {
        let (model, service) = await setup(loads: [{ RecurringFixtures.snapshot(dismissed: [RecurringFixtures.candidate(RecurringFixtures.fp2)]) }])
        model.dismiss(candidate)
        await model.settled()
        #expect(model.notice == .dismissed && model.expanded.contains(.dismissed))
        model.reconsider(RecurringFixtures.candidate(RecurringFixtures.fp2))
        await model.settled()
        #expect(model.notice == .reconsidered && service.writes.count == 2)
        model.reconsider(candidate)
        await model.settled()
        #expect(service.writes.count == 2)
    }

    @Test func confirmSendsExactBytesAndAlreadyConfirmedIsSuccess() async {
        let (model, service) = await setup()
        model.beginConfirm(candidate)
        #expect(model.isSheetPresented)
        model.submitConfirm()
        await model.settled()
        guard case .confirm(let fingerprint, let body) = service.writes[0].operation else { Issue.record("wrong write"); return }
        #expect(fingerprint == RecurringFixtures.fp1 && String(decoding: body, as: UTF8.self).contains(#""expectedAmount":12.34,"#))
        #expect(model.notice == .confirmed && model.confirm == nil && !model.isSheetPresented)
    }

    @Test func invalidFormSendsNothing() async {
        let (model, service) = await setup()
        model.beginConfirm(candidate)
        model.editConfirm { $0.name = "" }
        model.submitConfirm()
        await model.settled()
        #expect(service.writes.isEmpty && model.confirm?.fieldErrors == [.name])
    }

    @Test func a400UnlocksTheFormWithTheCode() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.commitmentRejected("category_invalid") }])
        let loads = service.loadCount
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        #expect(model.writePhase == .idle && model.confirm?.errorCode == "category_invalid" && model.isSheetPresented)
        #expect(service.loadCount == loads)
    }

    @Test func fingerprintInvalidAlsoReadsAgain() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.commitmentRejected("fingerprint_invalid") }])
        let loads = service.loadCount
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        #expect(service.loadCount == loads + 1)
    }

    @Test func a422IsDefinitiveAndGeneric() async {
        let (model, _) = await setup(performs: [{ _ in throw APIError.commitmentRejected(nil) }])
        model.dismiss(candidate)
        await model.settled()
        #expect(model.writePhase == .idle && model.notice == .error(nil))
    }

    @Test func a404ReadsAgainAndShowsItsMessage() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.commitmentNotFound }])
        let loads = service.loadCount
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.notice == .error("commitment_not_found") && service.loadCount == loads + 1 && model.writePhase == .idle)
    }

    @Test func a409ClosesTheSheetWhenTheCandidateIsGoneAndKeepsItOtherwise() async {
        let (gone, _) = await setup(performs: [{ _ in throw APIError.commitmentConflict("candidate_changed") }],
                                    loads: [{ RecurringFixtures.snapshot() }, { RecurringFixtures.snapshot(candidates: []) }])
        gone.beginConfirm(candidate)
        gone.submitConfirm()
        await gone.settled()
        #expect(gone.confirm == nil && !gone.isSheetPresented && gone.notice == .error("candidate_changed"))
        let (kept, _) = await setup(performs: [{ _ in throw APIError.commitmentConflict("confirmation_conflict") }])
        kept.beginConfirm(candidate)
        kept.submitConfirm()
        await kept.settled()
        #expect(kept.isSheetPresented && kept.confirm?.errorCode == "confirmation_conflict")
    }

    @Test(arguments: [URLError(.timedOut), URLError(.notConnectedToInternet)])
    func timeoutsAreUncertainAndGateAllWrites(error: URLError) async {
        let (model, service) = await setup(performs: [{ _ in throw error }])
        model.dismiss(candidate)
        await model.settled()
        #expect(model.writePhase == .uncertain && !model.canWrite)
        model.perform(.pause, on: active)
        model.beginConfirm(candidate)
        #expect(service.writes.count == 1 && model.confirm == nil)
    }

    @Test(arguments: [500, 503, 418])
    func serverErrorsAreUncertain(status: Int) async {
        let (model, _) = await setup(performs: [{ _ in throw APIError.server(status) }])
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.writePhase == .uncertain)
    }

    @Test func aCancellationIsUncertain() async {
        let (model, _) = await setup(performs: [{ _ in throw CancellationError() }])
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.writePhase == .uncertain)
    }

    @Test func retrySendsTheIdenticalFrozenBytes() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }, { _ in }])
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        model.retry()
        await model.settled()
        #expect(service.writes.count == 2 && service.writes[0] == service.writes[1])
        #expect(model.writePhase == .idle && model.notice == .confirmed)
    }

    @Test func aDismissedSheetThenRetryRefusedShowsTheNoticeAndReviewWorksAgain() async {
        let (model, _) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.commitmentRejected("amount_invalid") }])
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        model.sheetDismissed()
        #expect(model.writePhase == .uncertain && model.confirm != nil && !model.isSheetPresented)
        model.retry()
        await model.settled()
        #expect(model.writePhase == .idle && model.notice == .error("amount_invalid"))
        #expect(model.confirm == nil && !model.isSheetPresented)
        model.beginConfirm(candidate)
        #expect(model.confirm != nil && model.isSheetPresented)
    }

    @Test func aDismissedSheetThenRetryConflictStaysUncertain() async {
        let (model, _) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.commitmentConflict("candidate_changed") }])
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        model.sheetDismissed()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.retryConflictCode == "candidate_changed")
        #expect(model.notice != .error("candidate_changed") && !model.canRetry)
    }

    @Test func a409OnRetryForcesACheck() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.commitmentConflict("candidate_changed") }])
        model.dismiss(candidate)
        await model.settled()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.retryConflictCode == "candidate_changed" && !model.canRetry)
        model.retry()
        #expect(service.writes.count == 2)
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked && model.retryConflictCode == nil)
    }

    @Test func aFailedCheckWithTheConfirmSheetOpenKeepsTheUncertainPanelNotTheChangedMessage() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }])
        model.beginConfirm(candidate)
        model.submitConfirm()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.isSheetPresented && model.showsConfirmForm)
        service.setLoads([{ throw APIError.offline }])
        await model.check()
        #expect(!model.isFormTargetListed)
        #expect(model.writePhase == .uncertain && model.confirm != nil && model.isSheetPresented)
        #expect(model.showsConfirmForm && !model.isChecking)
        #expect(model.canRetry)
    }

    @Test func checkReleasesTheGateOnlyAfterASuccessfulRead() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }])
        model.perform(.pause, on: active)
        await model.settled()
        service.setLoads([{ throw APIError.offline }])
        await model.check()
        #expect(model.writePhase == .uncertain && !model.canWrite)
        service.setLoads([{ RecurringFixtures.snapshot() }])
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked && model.canWrite)
    }

    @Test func anotherWriteInFlightBlocksRecurringWrites() async {
        let flag = Flag()
        let (model, service) = await setup(other: { flag.on })
        flag.on = true
        model.perform(.pause, on: active)
        model.dismiss(candidate)
        model.beginConfirm(candidate)
        #expect(service.writes.isEmpty && model.confirm == nil)
    }

    @Test func refreshFailureAfterAWriteHidesTheListAndSaysSo() async {
        let (model, _) = await setup(loads: [{ RecurringFixtures.snapshot() }, { throw APIError.offline }])
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.listState == .failed && model.snapshot == nil && model.notice == .refreshFailedAfterWrite)
    }

    @Test func aFailedOrMalformedReadHidesTheWholeList() async {
        let (model, service) = await setup()
        service.setLoads([{ throw RecurringReadError.malformed }])
        await model.refresh()
        #expect(model.listState == .malformed && model.snapshot == nil)
        service.setLoads([{ throw APIError.server(500) }])
        await model.refresh()
        #expect(model.listState == .failed)
    }

    @Test func aSessionResetDropsALateResponse() async {
        let gate = Gate()
        let (model, _) = await setup(performs: [{ _ in await gate.wait() }])
        model.perform(.pause, on: active)
        model.reset()
        await gate.release()
        await model.settled()
        #expect(model.notice == nil && model.writePhase == .idle && model.snapshot == nil)
    }

    @Test func aLateReadFromAnOlderSessionIsDropped() async {
        let gate = Gate()
        let service = ScriptedRecurringService(loads: [{ await gate.wait(); return RecurringFixtures.snapshot() }])
        let model = RecurringFixtures.model(service)
        let read = Task { await model.refresh() }
        await Task.yield()
        model.reset()
        await gate.release()
        _ = await read.value
        #expect(model.snapshot == nil && model.listState == .idle)
    }

    // MARK: Edit

    private func editWrite(_ write: CommitmentWrite) -> (id: String, body: String)? {
        if case .update(let id, let body) = write.operation { return (id, String(decoding: body, as: UTF8.self)) }
        return nil
    }

    @Test func editSendsAPutWithoutAFingerprintThenReadsAgain() async {
        let home = Counter()
        let (model, service) = await setup(home: home)
        let loads = service.loadCount
        for entry in [active, RecurringFixtures.commitment(lifecycle: .paused), RecurringFixtures.commitment(lifecycle: .ended)] {
            model.beginEdit(entry)
            #expect(model.isSheetPresented && model.isEditing && model.showsConfirmForm)
            model.editConfirm { $0.name = "Renamed" }
            model.submitConfirm()
            await model.settled()
            #expect(model.notice == .updated && model.confirm == nil && !model.isSheetPresented && model.writePhase == .idle)
        }
        #expect(service.writes.count == 3 && service.loadCount == loads + 3 && home.next() == 4)
        let sent = editWrite(service.writes[0])
        #expect(sent?.id == RecurringFixtures.id1 && sent?.body.contains(#""name":"Renamed""#) == true
                && sent?.body.contains("fingerprint") == false && sent?.body.contains(#""expectedAmount":1200.25,"#) == true)
    }

    @Test func editWithAnUnavailableAmountSendsNothingUntilEntered() async {
        let unavailable = RecurringFixtures.commitment(amount: .unavailable)
        let (model, service) = await setup(loads: [{ RecurringFixtures.snapshot(commitments: [unavailable]) }])
        model.beginEdit(unavailable)
        model.submitConfirm()
        #expect(service.writes.isEmpty && model.confirm?.fieldErrors == [.amount])
        model.editConfirm { $0.expectedText = "75.50" }
        model.submitConfirm()
        await model.settled()
        #expect(service.writes.count == 1 && editWrite(service.writes[0])?.body.contains(#""expectedAmount":75.50,"#) == true)
    }

    @Test func editRefusals400And422KeepTheFormAndTheDraft() async {
        for error in [APIError.commitmentRejected("name_invalid"), .commitmentRejected(nil)] {
            let (model, service) = await setup(performs: [{ _ in throw error }])
            let loads = service.loadCount
            model.beginEdit(active)
            model.editConfirm { $0.name = "My draft" }
            model.submitConfirm()
            await model.settled()
            let code: String? = if case .commitmentRejected(let value) = error { value } else { nil }
            #expect(model.writePhase == .idle && model.isSheetPresented && model.confirm?.draft.name == "My draft")
            #expect(model.confirm?.errorCode == (code ?? "request_failed") && model.notice == nil && service.loadCount == loads)
            model.editConfirm { $0.name = "Fixed" }
            #expect(model.confirm?.errorCode == nil)
        }
    }

    @Test func aRefusedRetryReopensTheEditSheetWithTheDraft() async {
        let (model, _) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.commitmentRejected("amount_invalid") }])
        model.beginEdit(active)
        model.editConfirm { $0.name = "My draft" }
        model.submitConfirm()
        await model.settled()
        model.sheetDismissed()
        #expect(model.writePhase == .uncertain && model.confirm != nil && !model.isSheetPresented)
        model.retry()
        await model.settled()
        #expect(model.writePhase == .idle && model.isSheetPresented && model.confirm?.draft.name == "My draft")
        #expect(model.confirm?.errorCode == "amount_invalid" && model.notice == nil)
    }

    @Test func edit404ClosesAndReadsAgain() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.commitmentNotFound }],
                                           loads: [{ RecurringFixtures.snapshot() }, { RecurringFixtures.snapshot(commitments: []) }])
        let loads = service.loadCount
        model.beginEdit(active)
        model.submitConfirm()
        await model.settled()
        #expect(model.confirm == nil && !model.isSheetPresented && model.notice == .error("commitment_not_found"))
        #expect(service.loadCount == loads + 1 && model.commitment(id: active.id) == nil && model.writePhase == .idle)
    }

    @Test func anUncertainEditRetriesTheIdenticalBytes() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.server(503) }, { _ in }])
        model.beginEdit(active)
        model.editConfirm { $0.category = "housing" }
        model.submitConfirm()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.isSheetPresented && model.showsConfirmForm && !model.canWrite)
        model.editConfirm { $0.category = "other" }
        #expect(model.confirm?.draft.category == "housing")
        model.retry()
        await model.settled()
        #expect(service.writes.count == 2 && service.writes[0] == service.writes[1])
        #expect(model.writePhase == .idle && model.notice == .updated && model.confirm == nil)
    }

    @Test func anUncertainEditCanBeChecked() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }])
        model.beginEdit(active)
        model.submitConfirm()
        await model.settled()
        service.setLoads([{ throw APIError.offline }])
        await model.check()
        #expect(model.writePhase == .uncertain && model.confirm != nil && model.draftSurvives)
        service.setLoads([{ RecurringFixtures.snapshot() }])
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked && model.confirm == nil)
    }

    @Test func a409OnAnEditRetryForcesACheck() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.commitmentConflict("amount_invalid") }])
        model.beginEdit(active)
        model.submitConfirm()
        await model.settled()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.retryConflictCode == "amount_invalid" && !model.canRetry)
        model.retry()
        #expect(service.writes.count == 2)
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked)
    }

    @Test func editWritesAreBlockedWhileAnotherWriteIsInFlightOrUnresolved() async {
        let flag = Flag()
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }], other: { flag.on })
        flag.on = true
        model.beginEdit(active)
        #expect(model.confirm == nil && service.writes.isEmpty)
        flag.on = false
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.writePhase == .uncertain)
        model.beginEdit(active)
        #expect(model.confirm == nil)
        let gate = Gate()
        let (busy, busyService) = await setup(performs: [{ _ in await gate.wait() }])
        busy.beginEdit(active)
        busy.submitConfirm()
        busy.submitConfirm()
        busy.beginEdit(active)
        #expect(await waitUntil { busyService.writes.count == 1 })
        #expect(busy.writePhase == .submitting && busyService.writes.count == 1)
        await gate.release()
        await busy.settled()
        #expect(busy.notice == .updated)
    }

    @Test func anEditDraftSurvivesAFailedReadWhileIdle() async {
        let (model, service) = await setup()
        model.beginEdit(active)
        model.editConfirm { $0.name = "Keep me" }
        service.setLoads([{ throw APIError.offline }])
        await model.refresh()
        #expect(model.confirm?.draft.name == "Keep me" && model.isSheetPresented)
    }

    @Test func groupsToggle() async {
        let (model, _) = await setup()
        model.toggleGroup(.paused)
        #expect(model.expanded.contains(.paused))
        model.toggleGroup(.paused)
        #expect(!model.expanded.contains(.paused))
    }
}

@MainActor private final class Flag { var on = false }

private extension RecurringViewModel {
    var draftSurvives: Bool { confirm?.draft.name.isEmpty == false }
}
