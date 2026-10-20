import Foundation
import Testing
@testable import Ordo

private let r1 = ImportFixtures.row1
private let someFile = URL(fileURLWithPath: "/private/var/synthetic-user-file-name.pdf")

private final class ReadFlag: @unchecked Sendable { nonisolated(unsafe) var started = false }

@MainActor @Suite struct ImportViewModelTests {
    // MARK: Opening and upload

    @Test func openShowsTheEmptyStateOrTheUnfinishedPreview() async {
        let service = ScriptedImportService()
        let model = importModel(service)
        await model.open()
        #expect(model.phase == .empty)
        service.onOpen = { ImportFixtures.preview() }
        let resumed = importModel(service)
        await resumed.open()
        #expect(resumed.phase == .review && resumed.rows.count == 2)
        service.onOpen = { throw APIError.offline }
        let failed = importModel(service)
        await failed.open()
        #expect(failed.phase == .loadFailed)
    }

    @Test func anUploadSendsTheFixedNameAndShowsTheServerPreview() async {
        let service = ScriptedImportService()
        let model = importModel(service)
        await model.open()
        model.chooseFile(someFile)
        await model.settled()
        #expect(model.phase == .review)
        let body = service.sentUploads.first
        let text = String(decoding: body?.data ?? Data(), as: UTF8.self)
        #expect(text.contains("filename=\"statement.pdf\"") && !text.contains("synthetic-user-file-name"))
    }

    @Test func aTooLargeFileIsRefusedBeforeAnyRequest() async {
        let service = ScriptedImportService()
        let model = importModel(service, readFile: { _ in throw StatementFileReader.ReadError.tooLarge })
        await model.open()
        model.chooseFile(someFile)
        await model.settled()
        #expect(model.phase == .empty && model.message == .upload("upload_too_large") && service.count("upload") == 0)
    }

    @Test func anyFourThirteenIsTheTooLargeMessage() async {
        let service = ScriptedImportService()
        service.onUpload = { throw refusal413 }
        let model = importModel(service)
        await model.open()
        model.chooseFile(someFile)
        await model.settled()
        #expect(model.message == .upload("upload_too_large") && model.phase == .empty)
    }

    @Test func eachRefusalCodeMapsToACatalogMessage() async {
        let presenter = ImportPresenter(l10n: L10n(language: .en))
        for code in ImportPresenter.uploadCodes {
            let text = presenter.messageText(.upload(code))
            #expect(!text.hasPrefix("importPreview"), "no entry for \(code)")
        }
        #expect(presenter.messageText(.upload("server-made-up")) == presenter.messageText(.upload(nil)))
    }

    @Test func anUnknownUploadOutcomeIsNeverResentAndTheOpenPreviewIsRead() async {
        let service = ScriptedImportService()
        service.onUpload = { throw APIError.offline }
        let model = importModel(service)
        await model.open()
        model.chooseFile(someFile)
        await model.settled()
        #expect(service.count("upload") == 1 && service.count("open") == 2)
        #expect(model.phase == .empty && model.message == .uploadUncertain)
    }

    @Test func aCancelledUploadReadsTheOpenPreview() async {
        let service = ScriptedImportService()
        service.onUpload = { throw CancellationError() }
        let model = importModel(service)
        await model.open()
        model.chooseFile(someFile)
        await model.settled()
        #expect(service.count("upload") == 1 && service.count("open") == 2 && model.phase == .empty)
    }

    @Test func aChooseIsRefusedWhileAnotherWriteRuns() async {
        let service = ScriptedImportService()
        let model = importModel(service, other: { true })
        await model.open()
        model.chooseFile(someFile)
        #expect(model.phase == .empty && service.count("upload") == 0)
    }

    // MARK: Rows

    @Test func aToggleSendsAnAbsoluteBodyAndShowsOnlyTheServerRow() async throws {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onRow = { ImportFixtures.row(ImportFixtures.rowJSON(r1, selected: true)) }
        let row = try #require(model.rows.first)
        model.setExpenseSelected(row, true)
        #expect(model.isWriting && model.rows[0].selectedForImport == false)
        await model.settled()
        #expect(model.rows[0].selectedForImport && !model.isWriting)
        #expect(String(decoding: service.sentRowBodies[0], as: UTF8.self).contains(#""selectedForImport":true"#))
    }

    @Test func anUnknownRowWriteRetriesTheSameBytesAndABlockedConfirm() async throws {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onRow = { throw APIError.server(503) }
        model.setExpenseSelected(model.rows[0], true)
        await model.settled()
        #expect(model.rowWrite?.phase == .uncertain && !model.canConfirm && !model.canEdit)
        model.retryRow()
        await model.settled()
        #expect(service.sentRowBodies.count == 2 && service.sentRowBodies[0] == service.sentRowBodies[1])
    }

    @Test func aRefusalOnRetryShowsAMessageAndClearsTheState() async {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onRow = { throw APIError.offline }
        model.setExpenseSelected(model.rows[0], true)
        await model.settled()
        service.onRow = { throw refused(400, "row_not_selectable") }
        model.retryRow()
        await model.settled()
        #expect(model.rowWrite == nil && model.message == .update("row_not_selectable") && model.canEdit)
    }

    @Test func aFailedReloadKeepsTheUncertainPanelAndNeverSaysChanged() async {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onRow = { throw APIError.offline }
        model.setExpenseSelected(model.rows[0], true)
        await model.settled()
        service.onPreview = { throw APIError.offline }
        await model.reload()
        #expect(model.rowWrite?.phase == .uncertain && model.message == .reloadFailed && model.phase == .review)
        service.onPreview = { ImportFixtures.preview() }
        await model.reload()
        #expect(model.rowWrite == nil && model.canEdit)
    }

    @Test func aMissingPreviewOnARowWriteClearsItAsUnavailable() async {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onRow = { throw refused(404) }
        model.setExpenseSelected(model.rows[0], true)
        await model.settled()
        #expect(model.phase == .empty && model.preview == nil && model.message == .unavailable)
    }

    // MARK: Bulk

    @Test func bulkReplaysOnceThenLocksConfirmUntilReload() async {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        service.onSelect = { throw APIError.offline }
        model.selectEligibleExpenses()
        await model.settled()
        #expect(service.count("select") == 2 && service.sentSelectionBodies[0] == service.sentSelectionBodies[1])
        #expect(model.needsReload && !model.canConfirm && model.message == .bulkUncertain)
        await model.reload()
        #expect(!model.needsReload)
    }

    @Test func bulkSuccessReplacesThePreviewAndAReplayCanSucceed() async {
        let service = ScriptedImportService()
        let model = await reviewing(service)
        let counter = Counter()
        service.onSelect = {
            if counter.next() == 1 { throw APIError.offline }
            return ImportFixtures.preview([ImportFixtures.rowJSON(r1, selected: true), ImportFixtures.rowJSON(ImportFixtures.row2, selected: true)])
        }
        model.selectEligibleExpenses()
        await model.settled()
        #expect(service.count("select") == 2 && model.totals.expenseCount == 2 && !model.needsReload)
        service.onSelect = { throw refused(400) }
        model.clearSelection()
        await model.settled()
        #expect(model.message == .bulkFailed && model.totals.expenseCount == 2)
    }

    // MARK: Confirm

    private func selected(_ service: ScriptedImportService, _ counter: ImportRefreshCounter = ImportRefreshCounter()) async -> ImportViewModel {
        service.onOpen = { ImportFixtures.preview([ImportFixtures.rowJSON(r1, selected: true)]) }
        let model = importModel(service, counter: counter)
        await model.open()
        return model
    }

    @Test func confirmSucceedsAndRefreshesTheOtherTabsOnce() async {
        let service = ScriptedImportService(), counter = ImportRefreshCounter()
        let model = await selected(service, counter)
        #expect(model.canConfirm)
        model.confirm()
        #expect(model.isWriting && !model.canConfirm)
        await model.settled()
        #expect(model.phase == .completed && model.completion?.alreadyConfirmed == false && model.preview == nil)
        #expect(counter.count == 1 && service.count("confirm") == 1)
    }

    @Test func alreadyConfirmedIsACompletionToo() async throws {
        let service = ScriptedImportService(), counter = ImportRefreshCounter()
        service.onConfirm = { try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON("already_confirmed").utf8)) }
        let model = await selected(service, counter)
        model.confirm()
        await model.settled()
        #expect(model.completion?.alreadyConfirmed == true && counter.count == 1)
    }

    @Test func anUnknownConfirmRetriesOnlyOnTapWithTheSamePost() async {
        let service = ScriptedImportService(), counter = ImportRefreshCounter()
        service.onConfirm = { throw APIError.server(500) }
        let model = await selected(service, counter)
        model.confirm()
        await model.settled()
        #expect(model.confirmPhase == .uncertain && service.count("confirm") == 1 && counter.count == 0)
        model.retryConfirm()
        await model.settled()
        #expect(service.count("confirm") == 2 && model.confirmPhase == .uncertain)
        service.onConfirm = { try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON("already_confirmed").utf8)) }
        model.retryConfirm()
        await model.settled()
        #expect(model.phase == .completed && counter.count == 1)
    }

    @Test func closingAfterAnUnknownConfirmRefreshesTheOtherTabsAndResets() async {
        let service = ScriptedImportService(), counter = ImportRefreshCounter()
        service.onConfirm = { throw APIError.offline }
        let model = await selected(service, counter)
        model.confirm()
        await model.settled()
        await model.close()
        #expect(counter.count == 1 && model.phase == .idle && model.confirmPhase == .idle && model.preview == nil)
        service.onOpen = { nil }
        await model.open()
        #expect(model.phase == .empty)
    }

    @Test func aRefusalOnConfirmRetryShowsANoticeAndClearsTheUncertainState() async {
        let service = ScriptedImportService()
        service.onConfirm = { throw APIError.offline }
        let model = await selected(service)
        model.confirm()
        await model.settled()
        service.onConfirm = { throw refused(410, "preview_expired") }
        model.retryConfirm()
        await model.settled()
        #expect(model.confirmPhase == .idle && model.message == .confirm("preview_expired") && model.phase == .empty)
    }

    @Test func duplicateReviewReadsThePreviewAgainOrLocksConfirm() async {
        let service = ScriptedImportService()
        service.onConfirm = { throw refused(409, "duplicate_review_required") }
        let model = await selected(service)
        service.onPreview = { ImportFixtures.preview([ImportFixtures.rowJSON(r1, selected: false, duplicate: true)]) }
        model.confirm()
        await model.settled()
        #expect(model.message == .confirm("duplicate_review_required") && model.totals.expenseCount == 0 && !model.needsReload)
        let failing = await selected(service)
        service.onPreview = { throw APIError.offline }
        failing.confirm()
        await failing.settled()
        #expect(failing.needsReload && failing.message == .duplicateRefreshFailed && !failing.canConfirm)
    }

    @Test func confirmStaysBusyUntilTheDuplicateReReadFinishes() async {
        let service = ScriptedImportService(), gate = Gate(), reading = ReadFlag()
        service.onConfirm = { throw refused(409, "duplicate_review_required") }
        let model = await selected(service)
        service.onPreview = {
            reading.started = true
            await gate.wait()
            return ImportFixtures.preview([ImportFixtures.rowJSON(r1, selected: false, duplicate: true)])
        }
        model.confirm()
        while !reading.started { await Task.yield() }
        #expect(!model.canEdit && !model.canConfirm && model.isWriting)
        await gate.release()
        await model.settled()
        #expect(model.confirmPhase == .idle && model.totals.expenseCount == 0 && !model.canConfirm)
    }

    @Test func closingAfterAConflictOnConfirmRetryStillRefreshesTheOtherTabs() async {
        let service = ScriptedImportService(), counter = ImportRefreshCounter()
        service.onConfirm = { throw APIError.offline }
        let model = await selected(service, counter)
        model.confirm()
        await model.settled()
        service.onConfirm = { throw refused(409, "confirmation_conflict") }
        model.retryConfirm()
        await model.settled()
        #expect(model.confirmPhase == .idle)
        await model.close()
        #expect(counter.count == 1)
    }

    @Test func otherRefusalsKeepThePreviewAndAMissingBatchClearsIt() async {
        let service = ScriptedImportService()
        service.onConfirm = { throw refused(422, "confirmation_validation_failed") }
        let model = await selected(service)
        model.confirm()
        await model.settled()
        #expect(model.phase == .review && model.message == .confirm("confirmation_validation_failed") && model.canConfirm)
        service.onConfirm = { throw refused(404) }
        model.confirm()
        await model.settled()
        #expect(model.phase == .empty && model.message == .confirm("preview_unavailable"))
    }

    @Test func confirmIsDisabledWhileAnythingElseIsPending() async {
        let service = ScriptedImportService(), blocked = Counter()
        let model = importModel(service, other: { blocked.next() > 0 })
        service.onOpen = { ImportFixtures.preview([ImportFixtures.rowJSON(r1, selected: true)]) }
        await model.open()
        #expect(!model.canConfirm)
        let free = await selected(service)
        #expect(free.canConfirm)
        let gate = Gate()
        service.onRow = { await gate.wait(); return ImportFixtures.row(ImportFixtures.rowJSON(r1)) }
        free.setExpenseSelected(free.rows[0], false)
        #expect(!free.canConfirm)
        await gate.release()
        await free.settled()
        #expect(!free.canConfirm)   // nothing selected any more
    }

    @Test func aLateResponseAfterResetIsIgnored() async {
        let service = ScriptedImportService(), counter = ImportRefreshCounter(), gate = Gate()
        service.onConfirm = { await gate.wait(); return try ImportValidation.parseConfirmation(Data(ImportFixtures.confirmationJSON().utf8)) }
        let model = await selected(service, counter)
        model.confirm()
        model.reset()
        await gate.release()
        await model.settled()
        #expect(model.phase == .idle && model.completion == nil && counter.count == 0 && !model.isWriting)
    }

    @Test func anEndedSessionResetsEverything() async {
        let service = ScriptedImportService()
        service.onConfirm = { throw APIError.sessionEnded }
        let model = await selected(service)
        model.confirm()
        await model.settled()
        #expect(model.phase == .idle && model.preview == nil)
    }
}
