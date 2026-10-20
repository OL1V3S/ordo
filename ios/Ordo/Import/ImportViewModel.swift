import Foundation
import Observation
import os

/// The statement import: find an unfinished preview, upload a PDF, review and edit the rows, then
/// confirm. Everything shown is what the server last reported; there are no optimistic updates.
///
/// ```
/// loading -> empty | review | loadFailed          (GET open)
/// empty -> uploading -> review | empty            (a refusal) | loading   (an unknown outcome: the PDF is dropped, GET open runs)
/// review: one row write, one bulk action or one confirm at a time
/// row   : submitting -> done | refused | uncertain (Retry sends the same bytes; Reload reads the preview)
/// bulk  : submitting -> done | refused | replayed once -> locked until Reload
/// confirm: submitting -> completed | refused | uncertain (Retry sends the same POST, never automatic)
/// ```
///
/// Why a confirm Retry cannot duplicate expenses: the server locks the batch and answers a second
/// confirm of a confirmed batch with `200 already_confirmed` and creates nothing. Upload is safe to
/// repeat: the server dedupes by document hash. A row write is an absolute state and a bulk action
/// sets state without toggling, so repeating either is safe. The unknown state is not persisted;
/// after the app is closed, the next `GET open` is the check. Nothing but static messages and status
/// codes is logged.
@MainActor @Observable
final class ImportViewModel {
    enum Phase: Equatable { case idle, loading, loadFailed, empty, uploading, review, completed }
    enum WritePhase: Equatable { case submitting, uncertain }
    enum ConfirmPhase: Equatable { case idle, submitting, uncertain }

    /// What the screen says; the presenter maps it to catalog text. Server text is never shown.
    enum Message: Equatable {
        case upload(String?)
        case uploadUncertain
        case fileUnreadable
        case update(String?)
        case bulkFailed
        case bulkUncertain
        case confirm(String?)
        case duplicateRefreshFailed
        case unavailable
        case reloadFailed
    }

    struct RowWrite: Equatable {
        let rowId: String
        let body: Data
        var phase: WritePhase
    }

    private(set) var phase: Phase = .idle
    private(set) var preview: ImportPreview?
    private(set) var filter: ImportFilter = .all
    private(set) var message: Message?
    private(set) var completion: ImportConfirmation?
    private(set) var rowWrite: RowWrite?
    private(set) var isBulkSubmitting = false
    private(set) var confirmPhase: ConfirmPhase = .idle
    /// The selection or the duplicate check could not be confirmed: Confirm waits for Reload.
    private(set) var needsReload = false
    private(set) var isReloading = false

    @ObservationIgnored private let service: ImportService
    @ObservationIgnored private let readFile: @Sendable (URL) throws -> Data
    @ObservationIgnored private let refreshOthers: @MainActor () async -> Void
    @ObservationIgnored private var isOtherWriteInFlight: @MainActor () -> Bool
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "import")
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var confirmBatchId: String?

    /// `refreshOthers` re-reads Home, Transactions, Budgets, Paychecks, Recurring and Reports.
    init(service: ImportService,
         readFile: @escaping @Sendable (URL) throws -> Data = { try StatementFileReader.read($0) },
         refreshOthers: @escaping @MainActor () async -> Void = {},
         isOtherWriteInFlight: @escaping @MainActor () -> Bool = { false }) {
        self.service = service
        self.readFile = readFile
        self.refreshOthers = refreshOthers
        self.isOtherWriteInFlight = isOtherWriteInFlight
    }

    func setOtherWriteInFlight(_ closure: @escaping @MainActor () -> Bool) { isOtherWriteInFlight = closure }

    // MARK: Derived state

    /// True while an upload, a row write, a bulk action or a confirm is on its way to the server.
    var isWriting: Bool {
        phase == .uploading || rowWrite?.phase == .submitting || isBulkSubmitting || confirmPhase == .submitting
    }

    private var isBusy: Bool { isWriting || isReloading }

    var rows: [ImportRow] { preview?.rows ?? [] }
    var reviewRows: [ImportRow] { rows.filter { !ImportReviewRules.isUnreadable($0) } }
    var visibleRows: [ImportRow] { reviewRows.filter { ImportReviewRules.matches($0, filter) } }
    var unreadableCount: Int { rows.filter(ImportReviewRules.isUnreadable).count }
    var summary: ImportReviewRules.Summary { ImportReviewRules.summarize(rows) }
    var totals: ImportReviewRules.Totals { ImportReviewRules.selectedTotals(rows) }
    var filterCounts: [ImportFilter: Int] { ImportReviewRules.counts(reviewRows) }

    /// Rows can be edited, selected or bulk-changed.
    var canEdit: Bool {
        phase == .review && !isBusy && rowWrite == nil && confirmPhase == .idle && !needsReload && !isOtherWriteInFlight()
    }
    var bulkSelectableCount: Int { ImportReviewRules.bulkSelectableExpenses(rows).count }
    var canConfirm: Bool {
        canEdit && (totals.expenseCount + totals.depositCount) > 0
    }
    var canRetryConfirm: Bool { confirmPhase == .uncertain && !isOtherWriteInFlight() }
    var canRetryRow: Bool { rowWrite?.phase == .uncertain && !isBusy && !isOtherWriteInFlight() }
    var canReload: Bool {
        phase == .review && !isBusy && confirmPhase == .idle && (needsReload || rowWrite?.phase == .uncertain)
    }
    var canChooseFile: Bool { phase == .empty && !isOtherWriteInFlight() }

    func setFilter(_ value: ImportFilter) { filter = value }
    func dismissMessage() { message = nil }

    // MARK: Opening

    /// Looks for an unfinished preview the first time the screen opens.
    func open() async {
        guard phase == .idle else { return }
        await load()
    }

    func load() async {
        let started = generation
        phase = .loading
        message = nil
        do {
            let found = try await service.openPreview()
            guard generation == started else { return }
            if let found { preview = found; phase = .review } else { preview = nil; phase = .empty }
        } catch {
            guard generation == started else { return }
            if Self.isSessionEnd(error) { reset(); return }
            logger.error("The import preview could not be loaded")
            phase = .loadFailed
        }
    }

    // MARK: Upload

    /// Reads the picked PDF into memory, uploads it once, and drops the bytes. An unknown outcome is
    /// never resent: the open preview is read instead and the user can choose the file again.
    func chooseFile(_ url: URL) {
        guard canChooseFile else { return }
        phase = .uploading
        message = nil
        let started = generation
        let service = self.service
        let readFile = self.readFile
        task = Task { @MainActor [weak self] in
            let read: Result<Data, Error> = await Task.detached { Result { try readFile(url) } }.value
            guard let self, self.generation == started else { return }
            let pdf: Data
            switch read {
            case .success(let data): pdf = data
            case .failure(let error):
                self.phase = .empty
                self.message = (error as? StatementFileReader.ReadError) == .tooLarge ? .upload("upload_too_large") : .fileUnreadable
                return
            }
            let outcome = await Self.classify { try await service.upload(MultipartBody.make(pdf: pdf)) }
            guard self.generation == started else { return }
            switch outcome {
            case .done(let found):
                self.preview = found
                self.needsReload = false
                self.phase = .review
            case .refused(let status, let code):
                self.phase = .empty
                self.message = .upload(status == 413 ? "upload_too_large" : code)
            case .sessionEnded:
                self.reset()
            case .uncertain:
                self.logger.error("A statement upload could not be confirmed")
                // A new task: a cancelled upload must not cancel the read that finds out what happened.
                await Task { @MainActor in await self.load() }.value
                guard self.generation == started else { return }
                if self.phase == .empty { self.message = .uploadUncertain }
            }
        }
    }

    func cancelUpload() { if phase == .uploading { task?.cancel() } }

    // MARK: Row edits

    func setExpenseSelected(_ row: ImportRow, _ selected: Bool) {
        sendRow(row, description: row.editableExpenseDescription, category: row.category, expense: selected, deposit: false)
    }

    func setDepositSelected(_ row: ImportRow, _ selected: Bool) {
        sendRow(row, description: nil, category: nil, expense: false, deposit: selected)
    }

    func saveDetails(_ row: ImportRow, description: String, category: String) {
        sendRow(row, description: description, category: category, expense: row.selectedForImport, deposit: false)
    }

    private func sendRow(_ row: ImportRow, description: String?, category: String?, expense: Bool, deposit: Bool) {
        guard canEdit, preview?.rows.contains(where: { $0.rowId == row.rowId }) == true else { return }
        let body = ImportRequestBody.row(description: description, category: category,
                                         selectedForImport: expense, selectedForInflow: deposit)
        message = nil
        runRow(RowWrite(rowId: row.rowId, body: body, phase: .submitting))
    }

    /// Sends the same bytes again.
    func retryRow() {
        guard canRetryRow, var write = rowWrite else { return }
        write.phase = .submitting
        message = nil
        runRow(write)
    }

    private func runRow(_ write: RowWrite) {
        guard let batchId = preview?.batchId else { return }
        rowWrite = write
        let started = generation
        let service = self.service
        task = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.updateRow(batchId: batchId, rowId: write.rowId, body: write.body) }
            guard let self, self.generation == started else { return }
            switch outcome {
            case .done(let row):
                self.rowWrite = nil
                if let current = self.preview, let index = current.rows.firstIndex(where: { $0.rowId == row.rowId }) {
                    var rows = current.rows
                    rows[index] = row
                    self.preview = ImportPreview(batchId: current.batchId, expiresAt: current.expiresAt, rows: rows)
                }
            case .refused(let status, let code):
                // A definitive refusal on the first send or on a Retry: say so and clear the write.
                self.rowWrite = nil
                if status == 404 { self.clearPreview(.unavailable) } else { self.message = .update(code) }
            case .sessionEnded:
                self.reset()
            case .uncertain:
                self.logger.error("A statement row change could not be confirmed")
                self.rowWrite = RowWrite(rowId: write.rowId, body: write.body, phase: .uncertain)
            }
        }
    }

    // MARK: Bulk

    func selectEligibleExpenses() { bulk(action: "select_expenses", targets: ImportReviewRules.bulkSelectableExpenses(rows)) }
    func clearSelection() { bulk(action: "clear", targets: ImportReviewRules.bulkClearTargets(rows)) }

    private func bulk(action: String, targets: [ImportRow]) {
        guard canEdit, let batchId = preview?.batchId, !targets.isEmpty else { return }
        let body = ImportRequestBody.selection(action: action, rowIds: targets.map(\.rowId))
        isBulkSubmitting = true
        message = nil
        let started = generation
        let service = self.service
        task = Task { @MainActor [weak self] in
            var outcome = await Self.classify { try await service.select(batchId: batchId, body: body) }
            if case .uncertain = outcome, self?.generation == started {
                // The web's single replay: the same bytes set the same state, so it is safe.
                outcome = await Self.classify { try await service.select(batchId: batchId, body: body) }
            }
            guard let self, self.generation == started else { return }
            self.isBulkSubmitting = false
            switch outcome {
            case .done(let fresh): self.preview = fresh
            case .refused(let status, _):
                if status == 404 { self.clearPreview(.unavailable) } else { self.message = .bulkFailed }
            case .sessionEnded: self.reset()
            case .uncertain:
                self.logger.error("A statement selection change could not be confirmed")
                self.needsReload = true
                self.message = .bulkUncertain
            }
        }
    }

    // MARK: Reload

    /// Reads the preview again. It replaces everything shown, and ends an unknown row or selection state.
    func reload() async {
        guard canReload, let batchId = preview?.batchId else { return }
        let started = generation
        isReloading = true
        defer { if generation == started { isReloading = false } }
        do {
            let fresh = try await service.preview(batchId: batchId)
            guard generation == started else { return }
            preview = fresh
            rowWrite = nil
            needsReload = false
            message = nil
        } catch {
            guard generation == started else { return }
            if Self.isSessionEnd(error) { reset(); return }
            if case APIError.importRefused(let status, _) = error, status == 404 || status == 410 {
                clearPreview(.unavailable)
            } else {
                // A failed read says nothing about the preview: the unknown state stays as it was.
                message = .reloadFailed
            }
        }
    }

    // MARK: Confirm

    func confirm() {
        guard canConfirm, let batchId = preview?.batchId else { return }
        message = nil
        confirmBatchId = batchId
        sendConfirm(batchId)
    }

    /// Sends the same POST again, once per tap.
    func retryConfirm() {
        guard canRetryConfirm, let batchId = confirmBatchId else { return }
        message = nil
        sendConfirm(batchId)
    }

    private func sendConfirm(_ batchId: String) {
        confirmPhase = .submitting
        let started = generation
        let service = self.service
        task = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.confirm(batchId: batchId) }
            guard let self, self.generation == started else { return }
            switch outcome {
            case .done(let confirmation):
                self.finishConfirm(confirmation)
                await self.refreshOthers()
            case .refused(let status, let code):
                self.confirmPhase = .idle
                self.confirmBatchId = nil
                await self.applyConfirmRefusal(status: status, code: code, batchId: batchId, started: started)
            case .sessionEnded:
                self.reset()
            case .uncertain:
                self.logger.error("A statement import could not be confirmed")
                self.confirmPhase = .uncertain
            }
        }
    }

    private func finishConfirm(_ confirmation: ImportConfirmation) {
        confirmPhase = .idle
        confirmBatchId = nil
        completion = confirmation
        preview = nil
        rowWrite = nil
        needsReload = false
        phase = .completed
    }

    private func applyConfirmRefusal(status: Int, code: String?, batchId: String, started: Int) async {
        switch (status, code) {
        case (410, _): clearPreview(.confirm("preview_expired"))
        case (404, _): clearPreview(.confirm("preview_unavailable"))
        case (409, "duplicate_review_required"):
            // The server already deselected the rows; read the preview to show it.
            message = .confirm(code)
            do {
                let fresh = try await service.preview(batchId: batchId)
                guard generation == started else { return }
                preview = fresh
            } catch {
                guard generation == started else { return }
                if Self.isSessionEnd(error) { reset(); return }
                needsReload = true
                message = .duplicateRefreshFailed
            }
        default: message = .confirm(code)
        }
    }

    // MARK: Leaving

    /// The user left the import. An unknown confirm may still have created expenses, so the other
    /// tabs are refreshed; the next open reads the open preview again.
    func close() async {
        guard !isWriting else { return }
        let uncertain = confirmPhase == .uncertain
        let finished = phase == .completed
        reset()
        if uncertain && !finished { await refreshOthers() }
    }

    /// Sign-out, an ended session or a fresh sign-in: drops everything, including a response still in flight.
    func reset() {
        generation += 1
        task?.cancel()
        task = nil
        phase = .idle
        preview = nil
        filter = .all
        message = nil
        completion = nil
        rowWrite = nil
        isBulkSubmitting = false
        confirmPhase = .idle
        confirmBatchId = nil
        needsReload = false
        isReloading = false
    }

    func settled() async { await task?.value }

    private func clearPreview(_ newMessage: Message) {
        preview = nil
        rowWrite = nil
        needsReload = false
        confirmPhase = .idle
        confirmBatchId = nil
        filter = .all
        phase = .empty
        message = newMessage
    }

    // MARK: Classification

    enum Outcome<Value: Sendable>: Sendable {
        case done(Value)
        case refused(status: Int, code: String?)
        case sessionEnded
        case uncertain
    }

    nonisolated static func isSessionEnd(_ error: Error) -> Bool {
        if case APIError.sessionEnded = error { return true }
        if case SessionError.signedOut = error { return true }
        return false
    }

    /// Anything not definitively classified (a timeout, offline, `5xx`, an unreadable or cancelled request) is uncertain.
    nonisolated static func classify<Value: Sendable>(_ operation: @Sendable () async throws -> Value) async -> Outcome<Value> {
        do {
            return .done(try await operation())
        } catch let error as APIError {
            switch error {
            case .importRefused(let status, let code): return .refused(status: status, code: code)
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }
}
