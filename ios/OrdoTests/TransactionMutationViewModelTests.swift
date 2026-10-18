import Foundation
import Testing
@testable import Ordo

private final class RefreshCounts: @unchecked Sendable {
    private let lock = NSLock()
    private var listCount = 0
    private var homeCount = 0
    private var listFresh = true
    var list: Int { lock.lock(); defer { lock.unlock() }; return listCount }
    var home: Int { lock.lock(); defer { lock.unlock() }; return homeCount }
    func setListFresh(_ fresh: Bool) { lock.lock(); listFresh = fresh; lock.unlock() }
    func hitList() -> Bool { lock.lock(); defer { lock.unlock() }; listCount += 1; return listFresh }
    func hitHome() { lock.lock(); homeCount += 1; lock.unlock() }
}

@MainActor private struct Rig {
    let model: TransactionMutationViewModel
    let service: ScriptedTransactionsService
    let counts = RefreshCounts()
    let otherWrite = Cell(false)

    init(_ performs: [ScriptedTransactionsService.Perform] = [{ _ in .applied }]) {
        service = ScriptedTransactionsService(performs: performs)
        let counts = self.counts
        let otherWrite = self.otherWrite
        model = TransactionMutationViewModel(
            service: service,
            refreshList: { counts.hitList() },
            refreshHome: { counts.hitHome() },
            isOtherWriteInFlight: { otherWrite.value },
            language: .en, deviceLocale: TimelineFixtures.english,
            now: { TimelineFixtures.fixedNow }, timeZone: TimelineFixtures.utc)
    }

    let expense = TimelineFixtures.item(.expense, id: 7, description: "Synthetic lunch", category: "Food")
    let deposit = TimelineFixtures.item(.accountInflow, id: 9, description: "Synthetic refund")

    func edit(_ item: TimelineItem? = nil) {
        model.beginEdit(item ?? expense)
        model.edit { $0.description = "Synthetic dinner"; $0.amountText = "13.25" }
    }

    func save() async {
        model.submitEdit()
        await model.settled()
    }

    func delete(_ item: TimelineItem? = nil) async {
        model.beginDelete(item ?? expense)
        model.confirmDelete()
        await model.settled()
    }
}

@MainActor @Suite struct TransactionMutationViewModelTests {
    // MARK: Opening

    @Test func tappingEditOpensTheFormPrefilledFromTheRow() {
        let rig = Rig()
        rig.model.beginEdit(rig.expense)
        #expect(rig.model.phase == .editing && rig.model.isSheetPresented)
        #expect(rig.model.draft.description == "Synthetic lunch" && rig.model.draft.amountText == "12.50")
        #expect(rig.model.draft.category == .food)
    }

    @Test func anExpenseThatNeedsReviewCannotBeEditedButCanBeDeleted() async {
        let rig = Rig()
        let review = TimelineFixtures.item(.expense, id: 8, amount: .needsReview("0.00"))
        rig.model.beginEdit(review)
        #expect(rig.model.phase == .idle)
        await rig.delete(review)
        #expect(rig.service.performs == [MutationRequest(kind: .expense, recordId: 8, operation: .delete)])
    }

    @Test func aDepositThatNeedsReviewOpensWithAnEmptyAmountAndMustBeEnteredAgain() async {
        let rig = Rig()
        let review = TimelineFixtures.item(.accountInflow, id: 5, amount: .needsReview("-1.50"))
        rig.model.beginEdit(review)
        #expect(rig.model.phase == .editing && rig.model.draft.amountText == "")
        rig.model.submitEdit()
        #expect(rig.model.fieldErrors == [.amount] && rig.service.performs.isEmpty)
        rig.model.edit { $0.amountText = "1.50" }
        await rig.save()
        #expect(rig.service.performs.count == 1)
    }

    @Test func invalidInputShowsFieldErrorsAndSendsNothing() {
        let rig = Rig()
        rig.model.beginEdit(rig.expense)
        rig.model.edit { $0.description = "   "; $0.amountText = "abc" }
        rig.model.submitEdit()
        #expect(rig.model.phase == .editing)
        #expect(rig.model.fieldErrors == [.description, .amount] && rig.model.formError == .checkFields)
        #expect(rig.model.focusRequest?.field == .description)
        #expect(rig.service.performs.isEmpty)
        rig.model.edit { $0.description = "ok" }
        #expect(rig.model.fieldErrors == [.amount])
    }

    @Test func aLegacyOtherCategoryMustBeChosenAgainBeforeSaving() {
        let rig = Rig()
        rig.model.beginEdit(TimelineFixtures.item(.expense, id: 4, category: "other"))
        rig.model.submitEdit()
        #expect(rig.model.fieldErrors == [.category] && rig.service.performs.isEmpty)
    }

    @Test func cancellingDiscardsTheFormAndSendsNothing() {
        let rig = Rig()
        rig.edit()
        rig.model.cancelEditing()
        #expect(rig.model.phase == .idle && !rig.model.isSheetPresented && rig.model.target == nil)
        rig.model.beginDelete(rig.expense)
        rig.model.cancelDelete()
        #expect(rig.model.phase == .idle && rig.service.performs.isEmpty)
        #expect(rig.counts.list == 0 && rig.counts.home == 0)
    }

    // MARK: Sending

    @Test func theFrozenUpdateCarriesTheValidatedValues() async {
        let rig = Rig()
        rig.edit()
        await rig.save()
        let expected = CaptureValidation.FrozenValues(amount: "13.25", descriptionText: "Synthetic dinner",
                                                      date: "2026-10-17", category: "food")
        #expect(rig.service.performs == [MutationRequest(kind: .expense, recordId: 7, operation: .update(expected))])
    }

    @Test func aDepositUpdateHasNoCategory() async {
        let rig = Rig()
        rig.edit(rig.deposit)
        await rig.save()
        guard case .update(let values)? = rig.service.performs.first?.operation else {
            Issue.record("no update was sent")
            return
        }
        #expect(values.category == nil)
        #expect(rig.service.performs.first?.kind == .deposit && rig.service.performs.first?.recordId == 9)
    }

    @Test func twoRapidSavesSendOneRequest() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .applied }])
        rig.edit()
        rig.model.submitEdit()
        rig.model.submitEdit()
        rig.model.submitEdit()
        #expect(rig.model.phase == .submitting)
        #expect(await waitUntil { rig.service.performs.count == 1 })
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.performs.count == 1)
    }

    @Test func twoRapidConfirmsSendOneRequest() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .applied }])
        rig.model.beginDelete(rig.expense)
        rig.model.confirmDelete()
        rig.model.confirmDelete()
        #expect(await waitUntil { rig.service.performs.count == 1 })
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.performs.count == 1)
    }

    @Test func nothingElseCanStartWhileARequestIsInFlight() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .applied }])
        rig.edit()
        rig.model.submitEdit()
        #expect(!rig.model.canStart && rig.model.isSubmitting)
        let other = TimelineFixtures.item(.accountInflow, id: 12)
        rig.model.beginEdit(other)
        rig.model.beginDelete(other)
        #expect(rig.model.target?.recordId == 7 && rig.model.phase == .submitting)
        rig.model.edit { $0.description = "changed while locked" }
        #expect(rig.model.draft.description == "Synthetic dinner")
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.performs.count == 1)
    }

    @Test func anotherFeatureSavingBlocksEditsAndDeletes() {
        let rig = Rig()
        rig.otherWrite.value = true
        rig.model.beginEdit(rig.expense)
        rig.model.beginDelete(rig.expense)
        #expect(rig.model.phase == .idle && !rig.model.canStart)
        rig.otherWrite.value = false
        rig.model.beginEdit(rig.expense)
        #expect(rig.model.phase == .editing)
        rig.otherWrite.value = true
        rig.model.submitEdit() // blocked at the last moment too
        #expect(rig.model.phase == .editing && rig.service.performs.isEmpty)
    }

    // MARK: Definitive outcomes

    @Test func anAppliedEditRefreshesTheListAndHomeOnceEachAndSaysSo() async {
        let rig = Rig()
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .idle && !rig.model.isSheetPresented)
        #expect(rig.model.notice == .updated(.expense))
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
    }

    @Test func anAppliedDeleteRefreshesTheListAndHomeOnceEachAndSaysSo() async {
        let rig = Rig()
        await rig.delete(rig.deposit)
        #expect(rig.model.notice == .deleted(.deposit))
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
        #expect(rig.model.phase == .idle)
    }

    @Test func aNotFoundSaysTheRecordNoLongerExistsAndRefreshes() async {
        let rig = Rig([{ _ in .notFound }])
        rig.edit()
        await rig.save()
        #expect(rig.model.notice == .missing(.expense) && rig.model.phase == .idle)
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
        await rig.delete(rig.deposit)
        #expect(rig.model.notice == .missing(.deposit))
    }

    @Test func aFailedListRefreshAfterAChangeSaysSoInsteadOfClaimingFreshRows() async {
        let rig = Rig()
        rig.counts.setListFresh(false)
        rig.edit()
        await rig.save()
        #expect(rig.model.notice == .updatedRefreshFailed(.expense))
        await rig.delete()
        #expect(rig.model.notice == .deletedRefreshFailed(.expense))
        #expect(rig.counts.home == 2) // Home is refreshed regardless
    }

    @Test func aFirstAttemptBadRequestUnlocksTheFormWithTheFieldsAndFocus() async {
        let rig = Rig([{ _ in throw APIError.validationFailed([.amount, .category]) }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .editing && rig.model.fieldErrors == [.amount, .category])
        #expect(rig.model.formError == .checkFields && rig.model.focusRequest?.field == .amount)
        #expect(rig.model.request == nil && rig.model.isSheetPresented)
        #expect(rig.counts.list == 0 && rig.counts.home == 0)
        // The user fixes it and saves again: a new, first attempt.
        rig.service.setPerforms([{ _ in .applied }])
        rig.model.edit { $0.amountText = "5.00" }
        await rig.save()
        #expect(rig.model.notice == .updated(.expense))
    }

    @Test func aBadRequestWithNoKnownFieldShowsAGenericMessageAndUnlocks() async {
        let rig = Rig([{ _ in throw APIError.updateRejected }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .editing && rig.model.formError == .couldNotSave && rig.model.fieldErrors.isEmpty)
    }

    @Test func aBadRequestOnARetryNeverSaysNotSavedAndChecksTheServer() async {
        let rig = Rig([{ _ in throw APIError.offline }, { _ in throw APIError.validationFailed([.amount]) }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .uncertain)
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.model.phase == .idle && rig.model.notice == .checkList)
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
    }

    // MARK: Uncertain outcomes

    @Test(arguments: [
        APIError.offline, .server(500), .server(503), .server(403), .server(409), .invalidResponse, .conflict,
    ])
    func anythingNotDefinitiveIsUncertain(error: APIError) async {
        let rig = Rig([{ _ in throw error }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .uncertain)
        #expect(rig.model.request != nil && rig.model.isSheetPresented)
        #expect(rig.counts.list == 0 && rig.counts.home == 0) // nothing is guessed
    }

    @Test func aCancellationWhileSubmittingIsUncertain() async {
        let rig = Rig([{ _ in throw CancellationError() }])
        await rig.delete()
        #expect(rig.model.phase == .uncertain)
    }

    @Test func aBadRequestOnADeleteIsUncertain() async {
        let rig = Rig([{ _ in throw APIError.validationFailed([.amount]) }])
        await rig.delete()
        #expect(rig.model.phase == .uncertain && rig.model.isDeleteFlow)
    }

    @Test func retryResendsTheIdenticalFrozenRequestEvenIfTheFormIsChanged() async {
        let rig = Rig([{ _ in throw APIError.offline }, { _ in .applied }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .uncertain)
        rig.model.edit { $0.description = "ignored" }
        rig.model.retry()
        #expect(rig.model.phase == .submitting)
        await rig.model.settled()
        #expect(rig.service.performs.count == 2)
        #expect(rig.service.performs[0] == rig.service.performs[1])
        #expect(rig.model.notice == .updated(.expense))
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
    }

    @Test func aRetryOfADeleteThatFindsNothingIsTreatedAsGone() async {
        let rig = Rig([{ _ in throw APIError.server(502) }, { _ in .notFound }])
        await rig.delete()
        #expect(rig.model.phase == .uncertain)
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.model.notice == .missing(.expense) && rig.model.phase == .idle)
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
    }

    @Test func retryWaitsWhileAnotherFeatureIsSaving() async {
        let rig = Rig([{ _ in throw APIError.offline }, { _ in .applied }])
        await rig.delete()
        rig.otherWrite.value = true
        #expect(!rig.model.canRetry)
        rig.model.retry()
        #expect(rig.model.phase == .uncertain && rig.service.performs.count == 1)
        rig.otherWrite.value = false
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.service.performs.count == 2)
    }

    @Test func checkReReadsTheServerEndsTheUncertaintyAndSendsNothing() async {
        let rig = Rig([{ _ in throw APIError.offline }])
        rig.edit()
        await rig.save()
        await rig.model.check()
        #expect(rig.model.phase == .idle && rig.model.notice == .checkList && !rig.model.isSheetPresented)
        #expect(rig.counts.list == 1 && rig.counts.home == 1)
        #expect(rig.service.performs.count == 1)
        await rig.model.check() // nothing is waiting any more
        #expect(rig.counts.list == 1)
    }

    @Test func closingTheSheetKeepsAnUncertainChangeWaiting() async {
        let rig = Rig([{ _ in throw APIError.offline }])
        rig.edit()
        await rig.save()
        rig.model.sheetDismissed()
        #expect(rig.model.phase == .uncertain && !rig.model.isSheetPresented)
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.service.performs.count == 2)
    }

    @Test func dismissingTheSheetWhileEditingCancels() {
        let rig = Rig()
        rig.edit()
        rig.model.sheetDismissed()
        #expect(rig.model.phase == .idle)
    }

    // MARK: Session

    @Test func aSessionEndWhileSubmittingEndsQuietlyWithoutRefreshing() async {
        let rig = Rig([{ _ in throw SessionError.signedOut }])
        rig.edit()
        await rig.save()
        #expect(rig.model.phase == .idle && rig.model.notice == nil)
        #expect(rig.counts.list == 0 && rig.counts.home == 0)
    }

    @Test func invalidateDropsALateResponseAndEverythingElse() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .applied }])
        rig.edit()
        rig.model.submitEdit()
        #expect(await waitUntil { rig.service.performs.count == 1 })
        rig.model.invalidate()
        #expect(rig.model.phase == .idle && rig.model.target == nil && rig.model.request == nil)
        await gate.release()
        await rig.model.settled()
        try? await Task.sleep(for: .milliseconds(30))
        #expect(rig.model.phase == .idle && rig.model.notice == nil)
        #expect(rig.counts.list == 0 && rig.counts.home == 0) // the late success changed nothing
    }

    @Test func invalidateClearsAnUncertainChangeAndANotice() async {
        let rig = Rig([{ _ in throw APIError.offline }])
        await rig.delete()
        rig.model.invalidate()
        #expect(rig.model.phase == .idle && rig.model.request == nil)
        rig.service.setPerforms([{ _ in .applied }])
        await rig.delete()
        rig.model.invalidate()
        #expect(rig.model.notice == nil)
    }

    @Test func theFrozenRequestIsRedactedWhenPrinted() async {
        let rig = Rig([{ _ in throw APIError.offline }])
        rig.edit()
        await rig.save()
        guard let request = rig.model.request, case .update(let values) = request.operation else {
            Issue.record("no frozen update")
            return
        }
        for text in [String(describing: request), String(reflecting: request), "\(request)",
                     String(describing: values), String(reflecting: values)] {
            #expect(!text.contains("Synthetic") && !text.contains("13.25") && !text.contains("2026"))
        }
    }
}
