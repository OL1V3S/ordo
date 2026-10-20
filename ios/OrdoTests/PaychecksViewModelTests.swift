import Foundation
import Testing
@testable import Ordo

@MainActor @Suite struct PaychecksViewModelTests {
    private let active = PaycheckFixtures.profile()

    private func setup(performs: [ScriptedPaychecksService.Perform] = [{ _ in }],
                       loads: [ScriptedPaychecksService.Load] = [{ PaycheckFixtures.snapshot() }],
                       deposits: [SavedDeposit] = [], home: Counter = Counter(),
                       other: @escaping @MainActor () -> Bool = { false }) async -> (PaychecksViewModel, ScriptedPaychecksService) {
        let service = ScriptedPaychecksService(loads: loads, deposits: [{ deposits }], performs: performs)
        let model = await PaycheckFixtures.loaded(service, refreshOthers: { _ = home.next() }, other: other)
        return (model, service)
    }

    private func openNewDeposit(_ model: PaychecksViewModel) {
        model.beginReceipt(model.snapshot!.profiles[0])
    }

    // MARK: Menu and confirmation

    @Test func menuItemsFollowTheLifecycle() {
        #expect(PaychecksViewModel.actions(for: .active) == [.pause, .end])
        #expect(PaychecksViewModel.actions(for: .paused) == [.reactivate, .end])
        #expect(PaychecksViewModel.actions(for: .ended) == [.reactivate, .pause])
    }

    @Test func endNeedsConfirmationButPauseAndReactivateDoNot() async {
        let (model, service) = await setup()
        model.perform(.end, on: active)
        await model.settled()
        #expect(service.writes.isEmpty && model.endTarget == active)
        model.cancelEnd()
        model.perform(.pause, on: active)
        await model.settled()
        #expect(service.writes.count == 1)
        guard case .lifecycle(_, let value, let body) = service.writes[0].operation else { Issue.record("not lifecycle"); return }
        #expect(value == .paused && String(decoding: body, as: UTF8.self) == #"{"lifecycle":"paused"}"#)
        model.confirmEnd(active)
        await model.settled()
        #expect(service.writes.count == 2)
    }

    @Test func anActionNotInTheMenuIsRefused() async {
        let (model, service) = await setup()
        model.perform(.reactivate, on: active)
        await model.settled()
        #expect(service.writes.isEmpty)
    }

    // MARK: Taps and refresh

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
        let paused = PaycheckFixtures.snapshot([PaycheckFixtures.profile(lifecycle: .paused)])
        let (model, service) = await setup(loads: [{ PaycheckFixtures.snapshot() }, { paused }], home: home)
        let loadsBefore = service.loadCount
        let gate = Gate()
        service.setPerforms([{ _ in await gate.wait() }])
        model.perform(.pause, on: active)
        #expect(model.snapshot?.profiles[0].lifecycle == .active)
        await gate.release()
        await model.settled()
        #expect(service.loadCount == loadsBefore + 1)
        #expect(home.next() == 2)
        #expect(model.snapshot?.profiles[0].lifecycle == .paused)
        #expect(model.notice == .lifecycle && model.expanded.contains(.paused))
    }

    @Test func aFailedReadAfterAWriteHidesTheListAndSaysSo() async {
        let (model, service) = await setup()
        service.setLoads([{ throw APIError.offline }])
        model.perform(.pause, on: active)
        await model.settled()
        #expect(model.notice == .refreshFailedAfterWrite && model.listState == .failed && model.snapshot == nil)
    }

    // MARK: Recording

    @Test func recordingANewDepositSendsExactBytesAndAlreadyRecordedIsSuccess() async {
        let (model, service) = await setup()
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        guard case .record(let id, let body) = service.writes[0].operation else { Issue.record("not record"); return }
        #expect(id == PaycheckFixtures.id1)
        #expect(String(decoding: body, as: UTF8.self) == #"{"newInflow":{"amount":1200.25,"date":"2026-10-17","description":"Synthetic Employer"},"slotAnchor":"2026-10-16"}"#)
        #expect(model.notice == .receiptRecorded && model.receipt == nil && !model.isSheetPresented)
    }

    @Test func linkingASavedDepositSendsTheExistingId() async {
        let (model, service) = await setup(deposits: [PaycheckFixtures.deposit(9)])
        openNewDeposit(model)
        model.editReceipt { $0.source = .existing }
        _ = await waitUntil { await MainActor.run { model.depositsState != .loading && model.depositsState != .idle } }
        model.submitReceipt()
        await model.settled()
        #expect(service.writes.isEmpty) // nothing chosen yet
        model.editReceipt { $0.existingInflowId = 9 }
        model.submitReceipt()
        await model.settled()
        guard case .record(_, let body) = service.writes[0].operation else { Issue.record("not record"); return }
        #expect(String(decoding: body, as: UTF8.self) == #"{"existingInflowId":9,"slotAnchor":"2026-10-16"}"#)
    }

    @Test func aDepositClaimedByAnotherScheduleCannotBeSent() async {
        let claimed = PaycheckFixtures.snapshot([PaycheckFixtures.profile(),
                                                 PaycheckFixtures.profile(PaycheckFixtures.id2, lifecycle: .ended, evidence: [PaycheckFixtures.evidence(9)])])
        let (model, service) = await setup(loads: [{ claimed }], deposits: [PaycheckFixtures.deposit(9)])
        model.beginReceipt(model.snapshot!.profiles[0])
        model.editReceipt { $0.source = .existing }
        _ = await waitUntil { await MainActor.run { model.depositsState != .loading && model.depositsState != .idle } }
        model.editReceipt { $0.existingInflowId = 9 }
        #expect(model.linkableDeposits.isEmpty)
        model.submitReceipt()
        await model.settled()
        #expect(service.writes.isEmpty)
    }

    @Test func invalidNewDepositFieldsSendNothing() async {
        let (model, service) = await setup()
        openNewDeposit(model)
        model.editReceipt { $0.amountText = "0" }
        model.submitReceipt()
        await model.settled()
        #expect(service.writes.isEmpty && model.receipt?.fieldErrors == [.amount])
    }

    // MARK: Refusals

    @Test func a400UnlocksTheFormWithTheCodeAndRefreshesNothing() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.paycheckRejected("receipt_inflow_invalid") }])
        let loads = service.loadCount
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        #expect(model.writePhase == .idle && model.receipt?.errorCode == "receipt_inflow_invalid" && model.isSheetPresented)
        #expect(service.loadCount == loads)
    }

    @Test func a404RefreshesAndClosesTheTask() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.paycheckNotFound }])
        let loads = service.loadCount
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        #expect(model.receipt == nil && model.notice == .error("paycheck_not_found") && service.loadCount == loads + 1)
    }

    @Test func a409NotActiveClosesWhileSlotAndInflowCodesKeepTheSheetOpen() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.paycheckConflict("paycheck_not_active") }])
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        #expect(model.receipt == nil && model.notice == .error("paycheck_not_active"))
        service.setPerforms([{ _ in throw APIError.paycheckConflict("receipt_inflow_unavailable") }])
        let loads = service.loadCount
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        #expect(model.receipt?.errorCode == "receipt_inflow_unavailable" && model.isSheetPresented && service.loadCount == loads + 1)
    }

    // MARK: Uncertain

    @Test(arguments: [URLError(.timedOut), URLError(.notConnectedToInternet)])
    func anUnknownOutcomeGatesEveryPaycheckWrite(error: URLError) async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }, { _ in }])
        _ = error
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        #expect(model.writePhase == .uncertain && !model.canWrite)
        model.perform(.pause, on: active)
        model.beginRemove(active, PaycheckFixtures.evidence(5))
        model.beginReceipt(active)
        await model.settled()
        #expect(service.writes.count == 1 && model.removeTarget == nil)
    }

    @Test(arguments: [500, 503, 418])
    func fiveHundredsAndOddStatusesAreUncertain(status: Int) async {
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
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        model.retry()
        await model.settled()
        #expect(service.writes.count == 2 && service.writes[0] == service.writes[1])
        #expect(model.notice == .receiptRecorded && model.writePhase == .idle)
    }

    @Test func a409OnRetryForcesACheckAndNeverSaysNotSaved() async {
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }, { _ in throw APIError.paycheckConflict("paycheck_not_active") }])
        openNewDeposit(model)
        model.submitReceipt()
        await model.settled()
        model.retry()
        await model.settled()
        #expect(model.writePhase == .uncertain && model.retryConflictCode == "paycheck_not_active" && !model.canRetry)
        model.retry()
        await model.settled()
        #expect(service.writes.count == 2)
        await model.check()
        #expect(model.writePhase == .idle && model.retryConflictCode == nil && model.notice == .receiptChecked)
    }

    @Test func checkReleasesTheGateOnlyAfterASuccessfulRead() async {
        let home = Counter()
        let (model, service) = await setup(performs: [{ _ in throw APIError.offline }], home: home)
        model.perform(.pause, on: active)
        await model.settled()
        service.setLoads([{ throw APIError.offline }])
        await model.check()
        #expect(model.writePhase == .uncertain)
        service.setLoads([{ PaycheckFixtures.snapshot() }])
        await model.check()
        #expect(model.writePhase == .idle && model.notice == .checked && model.canWrite)
        #expect(service.writes.count == 1) // Check sends nothing
    }

    // MARK: Other writes, session

    @Test func anotherWriteInFlightBlocksPaycheckWrites() async {
        var busy = true
        let (model, service) = await setup(other: { busy })
        model.perform(.pause, on: active)
        model.beginReceipt(active)
        #expect(service.writes.isEmpty && model.receipt == nil)
        busy = false
        model.perform(.pause, on: active)
        await model.settled()
        #expect(service.writes.count == 1)
    }

    @Test func aSessionResetDropsALateResponse() async {
        let gate = Gate()
        let (model, _) = await setup(performs: [{ _ in await gate.wait() }])
        model.perform(.pause, on: active)
        model.reset()
        await gate.release()
        await model.settled()
        #expect(model.snapshot == nil && model.notice == nil && model.writePhase == .idle && model.listState == .idle)
    }

    @Test func aLateReadFromAnOlderSessionIsDropped() async {
        let gate = Gate()
        let service = ScriptedPaychecksService(loads: [{ await gate.wait(); return PaycheckFixtures.snapshot() }])
        let model = PaycheckFixtures.model(service)
        let read = Task { await model.refresh() }
        _ = await waitUntil { service.loadCount == 1 }
        model.reset()
        await gate.release()
        _ = await read.value
        #expect(model.snapshot == nil && model.listState == .idle)
    }

    // MARK: Removing

    @Test func removeIsOnlyForRecordedReceiptsAndWorksOnPausedAndEnded() async {
        let paused = PaycheckFixtures.profile(lifecycle: .paused, evidence: [PaycheckFixtures.evidence(5), PaycheckFixtures.evidence(6, kind: .confirmationEvidence)])
        let (model, service) = await setup(loads: [{ PaycheckFixtures.snapshot([paused]) }])
        model.beginRemove(paused, paused.evidence[1])
        #expect(model.removeTarget == nil)
        model.beginRemove(paused, paused.evidence[0])
        let target = model.removeTarget
        #expect(target == .init(profileId: PaycheckFixtures.id1, inflowId: 5))
        model.confirmRemove(target!)
        await model.settled()
        #expect(service.writes.first?.operation == .removeReceipt(id: PaycheckFixtures.id1, inflowId: 5))
        #expect(model.notice == .receiptRemoved)
    }
}
