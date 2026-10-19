import Foundation
import Testing
@testable import Ordo

private let october = BudgetFixtures.october
private let november = BudgetMonth(year: 2026, month: 11)!

@MainActor private struct Rig {
    let service: ScriptedBudgetsService
    let model: BudgetsViewModel
    let homeRefreshes = Cell(0)

    init(_ service: ScriptedBudgetsService = ScriptedBudgetsService(), now: @escaping @Sendable () -> Date = { TimelineFixtures.fixedNow }) {
        self.service = service
        let counter = homeRefreshes
        model = BudgetFixtures.model(service, refreshHome: { counter.value += 1 }, now: now)
    }

    static func loaded(_ service: ScriptedBudgetsService = ScriptedBudgetsService()) async -> Rig {
        let rig = Rig(service)
        await rig.model.loadIfNeeded()
        return rig
    }

    var food: BudgetLimitRow { BudgetFixtures.row(id: 11, category: "food", limit: "200.00") }

    func openAdd(_ choice: BudgetCategoryChoice? = .food, amount: String = "50", custom: String = "") {
        model.beginAdd()
        model.edit { $0.choice = choice; $0.amountText = amount; $0.customCategory = custom }
    }

    func openEdit(amount: String = "250") {
        model.beginEdit(food)
        model.edit { $0.amountText = amount }
    }
}

@MainActor @Suite struct BudgetsViewModelTests {
    // MARK: Reading

    @Test func theFirstReadLoadsTheCurrentMonthsLimitsAndSpending() async {
        let rig = await Rig.loaded()
        #expect(rig.model.month == october && rig.model.isCurrentMonth)
        #expect(rig.service.limitReads == [october])
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows))
        let queries = rig.service.pageReads
        #expect(queries.count == 1 && queries[0].filter.kind == .expense && queries[0].limit == 100)
        #expect(queries[0].filter.from?.isoString == "2026-10-01" && queries[0].filter.to?.isoString == "2026-10-17")
        #expect(rig.model.spending == .loaded(.empty))
        await rig.model.loadIfNeeded() // a second appearance does not read again
        #expect(rig.service.limitReads.count == 1 && rig.service.pageReads.count == 1)
    }

    @Test func rowsCompareWithTheRecordedSpending() async {
        let service = ScriptedBudgetsService(pages: [{ _ in BudgetFixtures.page([BudgetFixtures.expense(id: 1, amount: "190.00")]) }])
        let rig = await Rig.loaded(service)
        let evaluation = rig.model.evaluation(for: rig.food)
        #expect(evaluation.status == .nearLimit && evaluation.usedCents == 19_000 && evaluation.percentWhole == 95)
        #expect(rig.model.evaluation(for: BudgetFixtures.row(id: 12, category: "transport", limit: "50.50")).status == .withinLimit)
    }

    @Test func aSpendingFailureKeepsTheLimitsVisibleAndOffersARetry() async {
        let service = ScriptedBudgetsService(pages: [{ _ in throw APIError.offline }])
        let rig = await Rig.loaded(service)
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows))
        #expect(rig.model.spending == .failed && rig.model.showsSpendingRetry && !rig.model.spendingAvailable)
        #expect(rig.model.evaluation(for: rig.food).status == .spendingUnavailable)
        service.setPages([{ _ in BudgetFixtures.page([BudgetFixtures.expense(id: 1, amount: "20.00")]) }])
        await rig.model.retrySpending()
        #expect(rig.model.spending != .failed && !rig.model.showsSpendingRetry)
        #expect(rig.model.evaluation(for: rig.food).usedCents == 2_000)
    }

    @Test func aLimitsFailureShowsNoRowsAndRefreshLimitsRecovers() async {
        let service = ScriptedBudgetsService(limits: [{ _ in throw APIError.offline }])
        let rig = await Rig.loaded(service)
        #expect(rig.model.limits == .failed && rig.model.shownRows.isEmpty && !rig.model.canAdd)
        service.setLimits([{ _ in BudgetFixtures.defaultRows }])
        await rig.model.refreshLimits()
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows) && rig.model.canAdd)
    }

    @Test func aMalformedLimitsResponseShowsNoRows() async {
        let service = ScriptedBudgetsService(limits: [{ _ in throw BudgetReadError.malformed }])
        let rig = await Rig.loaded(service)
        #expect(rig.model.limits == .malformed && rig.model.shownRows.isEmpty && !rig.model.canAdd)
    }

    @Test func anExpenseWithoutACategoryMakesEveryRowsSpendingUnavailableWithTheRetry() async {
        let service = ScriptedBudgetsService(pages: [{ _ in
            BudgetFixtures.page([BudgetFixtures.expense(id: 1, amount: "5.00"), BudgetFixtures.expense(id: 2, amount: "9.00", category: "  ")])
        }])
        let rig = await Rig.loaded(service)
        #expect(rig.model.spendingAvailable && rig.model.showsSpendingRetry)
        for row in rig.model.shownRows {
            let evaluation = rig.model.evaluation(for: row)
            #expect(evaluation.status == .spendingNeedsReview && evaluation.usedCents == nil)
        }
    }

    @Test func aFutureMonthReadsNoSpendingAndEveryRowShowsZeroUsed() async {
        let rig = await Rig.loaded()
        rig.model.stepMonth(by: 1)
        await rig.model.settled()
        #expect(rig.model.month == november && rig.model.spending == .notNeeded && rig.model.spendingAvailable)
        #expect(rig.service.pageReads.count == 1) // only October's
        #expect(rig.service.limitReads == [october, november])
        #expect(rig.model.evaluation(for: rig.food).usedCents == 0)
        #expect(!rig.model.showsSpendingRetry)
    }

    // MARK: Month

    @Test func theMonthStepsAndJumpsBackToThisMonth() async {
        let rig = await Rig.loaded()
        #expect(!rig.model.canGoToCurrentMonth)
        rig.model.stepMonth(by: -1)
        await rig.model.settled()
        #expect(rig.model.month == BudgetMonth(year: 2026, month: 9)! && rig.model.canGoToCurrentMonth)
        // A past month covers the whole month.
        #expect(rig.service.pageReads.last?.filter.to?.isoString == "2026-09-30")
        rig.model.goToCurrentMonth()
        await rig.model.settled()
        #expect(rig.model.month == october && !rig.model.canGoToCurrentMonth)
    }

    @Test func aMonthChangeDropsTheOldMonthsLimitsAndSpending() async {
        let gate = Gate()
        let octoberRows = [BudgetFixtures.row(id: 1, category: "october-only", limit: "1.00")]
        let novemberRows = [BudgetFixtures.row(id: 2, category: "november-only", limit: "2.00")]
        let service = ScriptedBudgetsService(
            limits: [{ _ in await gate.wait(); return octoberRows }, { _ in novemberRows }],
            pages: [{ _ in await gate.wait(); return BudgetFixtures.page([BudgetFixtures.expense(id: 9, amount: "99.00", category: "october-only")]) }])
        let rig = Rig(service)
        let loading = Task { await rig.model.loadIfNeeded() }
        #expect(await waitUntil { service.limitReads.count == 1 && service.pageReads.count == 1 })
        rig.model.stepMonth(by: 1)
        await rig.model.settled() // the November reads finish while October's are still held
        #expect(rig.model.limits == .loaded(novemberRows) && rig.model.spending == .notNeeded)
        await gate.release()
        await loading.value
        await rig.model.settled()
        #expect(rig.model.limits == .loaded(novemberRows)) // the late October result was dropped
        #expect(rig.model.spending == .notNeeded && rig.model.month == november)
    }

    @Test func theMonthCannotChangeWhileAFormIsOpenAWriteIsPendingOrTheGateIsOn() async {
        let gate = Gate()
        let rig = await Rig.loaded()
        rig.openAdd()
        #expect(!rig.model.canChangeMonth && !rig.model.canStepBack && !rig.model.canStepForward)
        rig.model.stepMonth(by: 1)
        #expect(rig.model.month == october)
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.model.save()
        #expect(rig.model.isPending && !rig.model.canChangeMonth)
        rig.model.stepMonth(by: -1)
        #expect(rig.model.month == october)
        await gate.release()
        await rig.model.settled()
        // An unconfirmed change keeps the gate on and the month fixed.
        rig.service.setPerforms([{ _ in throw APIError.server(503) }])
        rig.openAdd()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.needsRefresh && !rig.model.canChangeMonth)
        rig.model.goToCurrentMonth()
        rig.model.stepMonth(by: 1)
        #expect(rig.model.month == october)
    }

    // MARK: One request per Save

    @Test func twoRapidSavesSendOneRequest() async {
        let gate = Gate()
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.openAdd()
        rig.model.save()
        rig.model.save()
        rig.model.save()
        #expect(await waitUntil { rig.service.writes.count == 1 })
        #expect(rig.service.writes.count == 1 && rig.model.isPending && rig.model.isWriting)
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.writes.count == 1)
    }

    @Test func twoRapidDeleteConfirmsSendOneRequest() async {
        let gate = Gate()
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.model.beginDelete(rig.food)
        rig.model.confirmDelete()
        rig.model.confirmDelete()
        #expect(await waitUntil { rig.service.writes.count == 1 })
        #expect(rig.model.isDeleting)
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.writes.count == 1 && !rig.model.isDeleting)
    }

    @Test func theFrozenWriteIsExactlyWhatWasValidated() async throws {
        let rig = await Rig.loaded()
        rig.openAdd(.other, amount: "12,5", custom: "  Pet   Care ")
        rig.model.edit { $0.amountText = "12.5" }
        rig.model.save()
        await rig.model.settled()
        let write = try #require(rig.service.writes.first)
        #expect(write == BudgetWrite(operation: .upsert(BudgetUpsert(category: "pet care", limit: Money.parse("12.50")!, month: october))))
    }

    @Test func anEditSendsTheStoredCategoryAndTheNewLimit() async throws {
        let rig = await Rig.loaded()
        rig.model.beginEdit(BudgetFixtures.row(id: 21, category: "  Food  ", limit: "200.00"))
        #expect(rig.model.draft.amountText == "200.00") // prefilled with the stored limit's exact text
        rig.model.edit { $0.amountText = "0" }
        rig.model.save()
        await rig.model.settled()
        let write = try #require(rig.service.writes.first)
        #expect(write == BudgetWrite(operation: .upsert(BudgetUpsert(category: "  Food  ", limit: Money.parse("0.00", allowZero: true)!, month: october))))
    }

    @Test func aLimitThatNeedsReviewIsPrefilledEmpty() async {
        let rig = await Rig.loaded()
        rig.model.beginEdit(BudgetFixtures.row(id: 22, category: "food", limit: nil))
        #expect(rig.model.task != nil && rig.model.draft.amountText.isEmpty)
    }

    @Test func aFailedLocalCheckShowsTheValidationMessageAndSendsNothing() async {
        let rig = await Rig.loaded()
        rig.openAdd(nil, amount: "")
        rig.model.save()
        #expect(rig.model.showsValidation && rig.model.invalidFields == [.category, .amount])
        #expect(rig.model.focusRequest?.field == .category)
        #expect(rig.service.writes.isEmpty && !rig.model.isPending)
        rig.model.edit { $0.choice = .food }
        #expect(rig.model.invalidFields == [.amount] && rig.model.showsValidation)
        rig.model.save()
        #expect(rig.model.focusRequest?.field == .amount && rig.service.writes.isEmpty)
        rig.model.edit { $0.amountText = "10" }
        #expect(!rig.model.showsValidation)
    }

    // MARK: What is disabled

    @Test func addEditDeleteAreDisabledWhileAFormIsOpenAWriteIsPendingOrTheGateIsOn() async {
        let gate = Gate()
        let rig = await Rig.loaded()
        #expect(rig.model.canAdd && rig.model.canEdit(rig.food) && rig.model.canDelete(rig.food))
        rig.openAdd()
        #expect(!rig.model.canAdd && !rig.model.canEdit(rig.food) && !rig.model.canDelete(rig.food))
        rig.model.beginDelete(rig.food)
        #expect(rig.model.deleteTarget == nil) // a form is open
        rig.model.beginEdit(rig.food)
        #expect(rig.model.task == .add)
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.model.save()
        #expect(!rig.model.canAdd && !rig.model.canSave && !rig.model.canRefreshLimits)
        rig.model.beginAdd()
        rig.model.beginDelete(rig.food)
        #expect(rig.model.deleteTarget == nil)
        await gate.release()
        await rig.model.settled()
        #expect(rig.model.canAdd)

        rig.service.setPerforms([{ _ in throw APIError.offline }])
        rig.model.beginDelete(rig.food)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.model.needsRefresh && !rig.model.canAdd && !rig.model.canEdit(rig.food) && !rig.model.canDelete(rig.food))
    }

    @Test func nothingIsAvailableWhileTheLimitsLoad() async {
        let gate = Gate()
        let service = ScriptedBudgetsService(limits: [{ _ in await gate.wait(); return BudgetFixtures.defaultRows }])
        let rig = Rig(service)
        let loading = Task { await rig.model.loadIfNeeded() }
        #expect(await waitUntil { service.limitReads.count == 1 })
        #expect(rig.model.limits == .loading && !rig.model.canAdd && !rig.model.canRefreshLimits && rig.model.shownRows.isEmpty)
        await gate.release()
        await loading.value
        #expect(rig.model.canAdd)
    }

    @Test func aBlankCategoryRowCanOnlyBeDeleted() async throws {
        let rows = [BudgetFixtures.row(id: 30, category: "  ", limit: "5.00")]
        let rig = await Rig.loaded(ScriptedBudgetsService(limits: [{ _ in rows }]))
        let row = try #require(rig.model.shownRows.first)
        #expect(!rig.model.canEdit(row) && rig.model.canDelete(row))
        rig.model.beginEdit(row)
        #expect(rig.model.task == nil)
        rig.model.beginDelete(row)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.service.writes == [BudgetWrite(operation: .delete(id: 30))])
        // Its category and spending are shown as unavailable, never as zero.
        #expect(rig.model.evaluation(for: row).status == .spendingNeedsReview)
    }

    @Test func anotherFeaturesWriteBlocksChangesHere() async {
        let rig = await Rig.loaded()
        let other = Cell(false)
        rig.model.setOtherWriteInFlight { other.value }
        #expect(rig.model.canAdd)
        other.value = true
        #expect(!rig.model.canAdd && rig.model.mutationDisabled && !rig.model.canEdit(rig.food))
        rig.model.beginAdd()
        #expect(rig.model.task == nil)
        other.value = false
        rig.openAdd()
        other.value = true
        rig.model.save()
        #expect(rig.service.writes.isEmpty && !rig.model.isPending)
        other.value = false
        rig.model.save()
        await rig.model.settled()
        #expect(rig.service.writes.count == 1)
    }

    // MARK: Known results

    @Test func anAppliedUpsertClosesTheFormRereadsTheLimitsOnceAndRefreshesHomeOnce() async {
        let gate = Gate()
        let updated = [BudgetFixtures.row(id: 11, category: "food", limit: "250.00")]
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.service.setLimits([{ _ in updated }])
        rig.openEdit()
        rig.model.save()
        #expect(await waitUntil { rig.service.writes.count == 1 })
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows)) // nothing optimistic
        #expect(rig.service.limitReads.count == 1 && rig.homeRefreshes.value == 0)
        await gate.release()
        await rig.model.settled()
        #expect(rig.model.limits == .loaded(updated))
        #expect(rig.service.limitReads.count == 2 && rig.homeRefreshes.value == 1)
        #expect(rig.model.feedback == .saved && !rig.model.needsRefresh && rig.model.task == nil && !rig.model.isPending)
        #expect(rig.service.pageReads.count == 1) // a budget write does not change spending
    }

    @Test(arguments: [MutationResult.applied, .notFound])
    func aDeleteEndsWithTheRowGoneOnA204AndOnA404(result: MutationResult) async {
        let after = [BudgetFixtures.row(id: 12, category: "transport", limit: "50.50")]
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in result }])
        rig.service.setLimits([{ _ in after }])
        rig.model.beginDelete(rig.food)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.service.writes == [BudgetWrite(operation: .delete(id: 11))])
        #expect(rig.model.limits == .loaded(after) && rig.model.feedback == .deleted)
        #expect(rig.service.limitReads.count == 2 && rig.homeRefreshes.value == 1)
        #expect(rig.model.deleteTarget == nil && !rig.model.needsRefresh && !rig.model.isPending)
    }

    @Test func aDeleteTargetsTheShownRowOfADuplicatedCategory() async throws {
        let rows = [BudgetFixtures.row(id: 1, category: "food", limit: "10.00"), BudgetFixtures.row(id: 2, category: "food", limit: "20.00")]
        let rig = await Rig.loaded(ScriptedBudgetsService(limits: [{ _ in rows }]))
        let shown = try #require(rig.model.shownRows.first)
        #expect(rig.model.shownRows.count == 1 && shown.id == 2)
        rig.model.beginDelete(shown)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.service.writes == [BudgetWrite(operation: .delete(id: 2))])
        if case .loaded(let all) = rig.model.limits { #expect(all.count == 2) } // nothing was merged locally
    }

    @Test func cancellingTheConfirmationSendsNothing() async {
        let rig = await Rig.loaded()
        rig.model.beginDelete(rig.food)
        #expect(rig.model.deleteTarget == rig.food && !rig.model.canAdd)
        rig.model.cancelDelete()
        #expect(rig.model.deleteTarget == nil && rig.service.writes.isEmpty && rig.model.canAdd)
        rig.model.confirmDelete()
        #expect(rig.service.writes.isEmpty)
    }

    @Test func aFailedLimitsReadAfterAWriteReportsItAsSavedOrDeletedAndKeepsTheGate() async {
        for isDelete in [false, true] {
            let rig = await Rig.loaded()
            rig.service.setLimits([{ _ in throw APIError.offline }])
            if isDelete {
                rig.model.beginDelete(rig.food)
                rig.model.confirmDelete()
            } else {
                rig.openEdit()
                rig.model.save()
            }
            await rig.model.settled()
            #expect(rig.model.feedback == (isDelete ? .deletedRefreshFailed : .savedRefreshFailed))
            #expect(rig.model.needsRefresh && rig.model.limits == .failed && rig.model.shownRows.isEmpty)
            #expect(rig.homeRefreshes.value == 1) // Home still hears about the change
            #expect(!rig.model.canAdd && rig.model.canRefreshLimits)
        }
    }

    // MARK: Unknown results

    @Test(arguments: [APIError.server(500), .server(503), .offline, .invalidResponse, .server(404), .server(409), .unauthorized])
    func anUnknownOutcomeOfASaveKeepsTheFormOpenWithSaveHeldBack(error: APIError) async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw error }])
        rig.openAdd(.bills, amount: "75")
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.feedback == .unconfirmed && rig.model.needsRefresh && !rig.model.isPending)
        #expect(rig.model.task == .add && rig.model.draft.amountText == "75") // the form stays open
        #expect(!rig.model.canSave) // Save is disabled by the gate
        #expect(rig.service.limitReads.count == 1 && rig.homeRefreshes.value == 0) // nothing is assumed
        rig.model.edit { $0.amountText = "80" } // the fields stay editable
        #expect(rig.model.draft.amountText == "80")
        rig.model.save()
        #expect(rig.service.writes.count == 1) // still nothing sent
        rig.model.cancelTask() // Cancel stays enabled
        #expect(rig.model.task == nil && rig.model.needsRefresh)
    }

    @Test func aCancelledRequestIsUnconfirmedToo() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw CancellationError() }])
        rig.openEdit()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.feedback == .unconfirmed && rig.model.needsRefresh)
    }

    @Test func anUnknownOutcomeOfADeleteClosesTheConfirmationAndGatesChanges() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.server(502) }])
        rig.model.beginDelete(rig.food)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.model.deleteTarget == nil && rig.model.feedback == .unconfirmed && rig.model.needsRefresh)
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows)) // nothing removed locally
    }

    @Test func onlyASuccessfulLimitsReadReleasesTheGateAndSaysToCheckTheLimits() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.offline }])
        rig.openAdd()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.needsRefresh)

        rig.service.setLimits([{ _ in throw APIError.offline }])
        await rig.model.refreshLimits()
        #expect(rig.model.needsRefresh && rig.model.feedback == .unconfirmed && rig.model.limits == .failed)
        #expect(!rig.model.canSave)

        rig.service.setLimits([{ _ in BudgetFixtures.defaultRows }])
        await rig.model.refreshLimits()
        #expect(!rig.model.needsRefresh && rig.model.feedback == .refreshed && rig.model.canSave)
        #expect(rig.model.task == .add) // the form is still there, ready for another try
    }

    @Test func aPullToRefreshAlsoReleasesTheGate() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.server(500) }])
        rig.model.beginDelete(rig.food)
        rig.model.confirmDelete()
        await rig.model.settled()
        #expect(rig.model.needsRefresh)
        await rig.model.refresh()
        #expect(!rig.model.needsRefresh && rig.model.feedback == .refreshed && rig.model.canAdd)
        #expect(rig.service.pageReads.count == 2) // pull to refresh re-reads the spending too
    }

    @Test func refreshingLimitsWithoutAGateJustClearsTheFeedback() async {
        let rig = await Rig.loaded()
        rig.openAdd()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.feedback == .saved)
        await rig.model.refreshLimits()
        #expect(rig.model.feedback == nil && !rig.model.needsRefresh)
    }

    @Test func aSavedButNotRefreshedChangeIsReleasedByARefresh() async {
        let rig = await Rig.loaded()
        rig.service.setLimits([{ _ in throw APIError.offline }])
        rig.openAdd()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.feedback == .savedRefreshFailed && rig.model.needsRefresh)
        rig.service.setLimits([{ _ in BudgetFixtures.defaultRows }])
        await rig.model.refreshLimits()
        #expect(!rig.model.needsRefresh && rig.model.canAdd)
    }

    // MARK: Server validation

    @Test func a400UnlocksTheFormWithTheValidationMessage() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.budgetRejected }])
        rig.openAdd(.other, amount: "30", custom: "Pets")
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.task == .add && !rig.model.isPending && rig.model.showsValidation)
        #expect(rig.model.focusRequest?.field == .customCategory)
        #expect(!rig.model.needsRefresh && rig.model.feedback == nil && rig.model.canSave)
        #expect(rig.service.limitReads.count == 1 && rig.homeRefreshes.value == 0)
        rig.model.edit { $0.customCategory = "Pet care" }
        #expect(!rig.model.showsValidation || rig.model.invalidFields.isEmpty)
    }

    @Test func a400OnAnEditFocusesTheLimit() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.budgetRejected }])
        rig.openEdit()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.showsValidation && rig.model.focusRequest?.field == .amount)
    }

    // MARK: Session and reset

    @Test func aSessionThatEndsDuringAWriteDropsEverythingWithoutRefreshing() async {
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in throw APIError.sessionEnded }])
        rig.openAdd()
        rig.model.save()
        await rig.model.settled()
        #expect(rig.model.task == nil && rig.model.feedback == nil && !rig.model.needsRefresh && !rig.model.isPending)
        #expect(rig.model.limits == .loading && rig.service.limitReads.count == 1 && rig.homeRefreshes.value == 0)
    }

    @Test func resetDropsEverythingIncludingALateResponse() async {
        let gate = Gate()
        let rig = await Rig.loaded()
        rig.service.setPerforms([{ _ in await gate.wait(); return .applied }])
        rig.model.stepMonth(by: -1)
        await rig.model.settled()
        rig.openAdd()
        rig.model.save()
        #expect(await waitUntil { rig.service.writes.count == 1 })
        rig.model.reset()
        #expect(rig.model.month == october && rig.model.limits == .loading && rig.model.spending == .loading)
        #expect(rig.model.task == nil && rig.model.feedback == nil && !rig.model.isPending && !rig.model.needsRefresh)
        let reads = rig.service.limitReads.count
        await gate.release()
        await rig.model.settled()
        try? await Task.sleep(for: .milliseconds(30))
        #expect(rig.service.limitReads.count == reads && rig.homeRefreshes.value == 0) // the late result did nothing
        #expect(rig.model.feedback == nil && rig.model.limits == .loading)
        await rig.model.loadIfNeeded() // a new session reads again
        #expect(rig.model.limits == .loaded(BudgetFixtures.defaultRows))
    }

    // MARK: Spending refreshes

    @Test func spendingIsReReadOnlyOnceTheScreenWasOpened() async {
        let rig = Rig()
        await rig.model.refreshSpendingIfLoaded()
        #expect(rig.service.pageReads.isEmpty)
        await rig.model.loadIfNeeded()
        await rig.model.refreshSpendingIfLoaded()
        #expect(rig.service.pageReads.count == 2)
    }

    @Test func theSpendingCutoffMovesWhenTheDeviceDayChanges() async {
        let now = Cell(TimelineFixtures.fixedNow)
        let rig = Rig(now: { now.value })
        await rig.model.loadIfNeeded()
        await rig.model.reloadIfDateChanged()
        #expect(rig.service.pageReads.count == 1) // same day: nothing to do
        now.value = TimelineFixtures.fixedNow.addingTimeInterval(86_400) // 2026-10-18 12:00 UTC
        await rig.model.reloadIfDateChanged()
        #expect(rig.service.pageReads.count == 2)
        #expect(rig.service.pageReads.last?.filter.to?.isoString == "2026-10-18")
        await rig.model.reloadIfDateChanged()
        #expect(rig.service.pageReads.count == 2)
    }
}
