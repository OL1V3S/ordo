import Foundation
import Observation
import os

/// Editing and deleting an expense or a deposit.
///
/// ```
/// idle -> editing (tap row / Edit)            -> submitting (Save)
/// idle -> confirmingDelete (Delete)           -> submitting (Confirm)
/// submitting -> idle + notice                 [2xx, or 404: the record is gone]
/// submitting -> editing with field errors     [400 on the first attempt]
/// submitting -> uncertain                     [timeout, offline, 5xx, anything unrecognised]
/// uncertain  -> submitting (Retry)            [the same frozen request, byte for byte]
/// uncertain  -> idle + notice (Check)         [the list and Home are re-read from the server]
/// anything   -> idle                          [sign-out or session end: `invalidate()`]
/// ```
///
/// Why a retry is safe without an `Idempotency-Key`. `PUT` is an absolute replacement (description,
/// amount, date and, for an expense, category are set to fixed values that the server validates
/// again), so applying the same frozen body twice leaves the same row as applying it once, and the
/// server's evidence revisions change only when stored values really differ. `PUT` never creates a
/// record, so a record deleted in the meantime answers `404` and nothing comes back. `DELETE` targets
/// a database-generated id that is never reused and is scoped to the owner; a repeat can only answer
/// `404` for the same record, and can never delete a different one. A `401` is refused before the
/// controller runs, so the single retry after a refresh cannot apply twice. Residual risk: last
/// write wins. A change made on another device between two attempts is overwritten by the retry, as
/// the first attempt would have.
@MainActor @Observable
final class TransactionMutationViewModel {
    enum Phase: Equatable {
        case idle
        case editing
        case confirmingDelete
        /// The request is frozen and in flight; the form is read-only.
        case submitting
        /// The outcome is not known. Retry (the same request) or check the server.
        case uncertain
    }

    /// A message shown on the Transactions tab after the change.
    enum Notice: Equatable {
        case updated(CaptureKind)
        case deleted(CaptureKind)
        /// `404`: the record no longer exists. Nothing was changed by this request.
        case missing(CaptureKind)
        case updatedRefreshFailed(CaptureKind)
        case deletedRefreshFailed(CaptureKind)
        /// The earlier attempt may or may not have been applied: check the list.
        case checkList
    }

    enum FormError: Equatable {
        case checkFields
        case couldNotSave
    }

    struct FocusRequest: Equatable {
        let field: CaptureField
        let serial: Int
    }

    private(set) var phase: Phase = .idle
    /// The row being edited or deleted.
    private(set) var target: TimelineItem?
    private(set) var draft: CaptureDraft
    private(set) var fieldErrors: Set<CaptureField> = []
    private(set) var formError: FormError?
    private(set) var focusRequest: FocusRequest?
    /// The frozen request while submitting or uncertain.
    private(set) var request: MutationRequest?
    private(set) var notice: Notice?
    private(set) var isSheetPresented = false

    /// Changed by `AppModel.setLanguage` (only while no write is in flight).
    var language: AppLanguage
    let deviceLocale: Locale
    let timeZone: TimeZone

    @ObservationIgnored private let service: TransactionsService
    @ObservationIgnored private let refreshList: @MainActor () async -> Bool
    @ObservationIgnored private let refreshHome: @MainActor () async -> Void
    @ObservationIgnored private let isOtherWriteInFlight: @MainActor () -> Bool
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "transactions")
    /// Incremented by `invalidate()`. A response that started under an older value is ignored.
    @ObservationIgnored private var generation = 0
    /// True once a request for the current change has been started (it may have reached the server).
    @ObservationIgnored private var attempted = false
    @ObservationIgnored private var focusSerial = 0
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    /// `refreshList` re-reads the first page of the timeline and returns whether the rows are fresh.
    /// `isOtherWriteInFlight` is true while another feature (Add expense or Add deposit) is saving.
    init(service: TransactionsService,
         refreshList: @escaping @MainActor () async -> Bool = { true },
         refreshHome: @escaping @MainActor () async -> Void = {},
         isOtherWriteInFlight: @escaping @MainActor () -> Bool = { false },
         language: AppLanguage = .current,
         deviceLocale: Locale = .current,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: TimeZone = .current) {
        self.service = service
        self.refreshList = refreshList
        self.refreshHome = refreshHome
        self.isOtherWriteInFlight = isOtherWriteInFlight
        self.language = language
        self.deviceLocale = deviceLocale
        self.now = now
        self.timeZone = timeZone
        draft = CaptureDraft(date: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone))
    }

    // MARK: Derived state

    /// One write at a time: row actions are available only when nothing is open and no capture is saving.
    var canStart: Bool { phase == .idle && !isOtherWriteInFlight() }
    /// A request is on its way to the server. Add expense and Add deposit wait for it.
    var isSubmitting: Bool { phase == .submitting }
    /// Retry is offered while the outcome is unknown, unless another write is saving.
    var canRetry: Bool { phase == .uncertain && !isOtherWriteInFlight() }
    var isDeleteFlow: Bool { request?.isDelete ?? (phase == .confirmingDelete) }

    // MARK: Starting

    func beginEdit(_ item: TimelineItem) {
        guard canStart, TransactionsPresenter.canEdit(item) else { return }
        target = item
        draft = TransactionsPresenter.editDraft(for: item)
        fieldErrors = []
        formError = nil
        notice = nil
        attempted = false
        phase = .editing
        isSheetPresented = true
    }

    func beginDelete(_ item: TimelineItem) {
        guard canStart else { return }
        target = item
        fieldErrors = []
        formError = nil
        notice = nil
        attempted = false
        phase = .confirmingDelete
    }

    /// Applies an edit only while the form is open. Once the request is frozen, edits are ignored.
    func edit(_ mutate: (inout CaptureDraft) -> Void) {
        guard phase == .editing else { return }
        let before = draft
        mutate(&draft)
        if draft.description != before.description { fieldErrors.remove(.description) }
        if draft.amountText != before.amountText { fieldErrors.remove(.amount) }
        if draft.date != before.date { fieldErrors.remove(.date) }
        if draft.category != before.category || draft.customCategory != before.customCategory {
            fieldErrors.remove(.category)
        }
    }

    func cancelEditing() {
        guard phase == .editing else { return }
        resetToIdle()
    }

    func cancelDelete() {
        guard phase == .confirmingDelete else { return }
        resetToIdle()
    }

    /// The sheet was dismissed by the system. A form in progress is cancelled. An unknown outcome
    /// stays, and the Transactions tab keeps offering Retry and Check.
    func sheetDismissed() {
        switch phase {
        case .editing: cancelEditing()
        case .uncertain: isSheetPresented = false
        case .idle, .confirmingDelete, .submitting: break
        }
    }

    func dismissNotice() { notice = nil }

    // MARK: Submitting

    /// Validate, freeze, then send. Everything up to the send is synchronous on the main actor, so a
    /// second tap cannot start a second request.
    func submitEdit() {
        guard phase == .editing, let target, !isOtherWriteInFlight() else { return }
        switch CaptureValidation.validateValues(draft, kind: target.captureKind, language: language,
                                                deviceLocale: deviceLocale) {
        case .failure(let failure):
            fieldErrors = failure.fields
            formError = .checkFields
            if let first = failure.first { requestFocus(first) }
        case .success(let values):
            start(MutationRequest(kind: target.captureKind, recordId: target.recordId, operation: .update(values)))
        }
    }

    /// Confirms the delete of the row the dialog presented. The dialog passes its own row so the
    /// request does not depend on `phase` and `target` still being set when the button's action runs
    /// (dismissing the dialog calls `cancelDelete()`, which clears both). A request that is already
    /// submitting or uncertain, or another feature's save in flight, still refuses it.
    func confirmDelete(_ item: TimelineItem) {
        guard phase == .idle || phase == .confirmingDelete, !isOtherWriteInFlight() else { return }
        start(MutationRequest(kind: item.captureKind, recordId: item.recordId, operation: .delete))
    }

    func confirmDelete() {
        guard phase == .confirmingDelete, let target else { return }
        confirmDelete(target)
    }

    /// Re-sends the frozen request unchanged.
    func retry() {
        guard phase == .uncertain, let request, !isOtherWriteInFlight() else { return }
        start(request)
    }

    /// Ends the unknown outcome by reading the server: the list and Home are re-read and the user
    /// sees what is saved. Nothing is guessed.
    func check() async {
        guard phase == .uncertain else { return }
        await finish(.checkList, generation: generation)
    }

    private func start(_ newRequest: MutationRequest) {
        request = newRequest
        phase = .submitting
        fieldErrors = []
        formError = nil
        let isRetry = attempted
        attempted = true
        let started = generation
        let service = self.service
        sendTask = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.perform(newRequest) }
            guard let self, self.generation == started else { return }
            await self.apply(outcome, for: newRequest, isRetry: isRetry, generation: started)
        }
    }

    /// Waits for the current send (and the refreshes that follow it). For tests.
    func settled() async { await sendTask?.value }

    // MARK: Outcomes

    enum Outcome: Equatable {
        case applied
        case notFound
        case rejected(Set<ValidationField>)
        case rejectedGeneric
        case uncertain
        case sessionEnded
    }

    /// Anything not definitively classified is uncertain, the safe default: a timeout, a dropped
    /// connection, a cancellation, a `5xx`, an unexpected status or a failed refresh.
    nonisolated static func classify(_ operation: @Sendable () async throws -> MutationResult) async -> Outcome {
        do {
            switch try await operation() {
            case .applied: return .applied
            case .notFound: return .notFound
            }
        } catch let error as APIError {
            switch error {
            case .validationFailed(let fields): return .rejected(fields)
            case .updateRejected: return .rejectedGeneric
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }

    private func apply(_ outcome: Outcome, for sent: MutationRequest, isRetry: Bool, generation started: Int) async {
        switch outcome {
        case .applied:
            await finish(sent.isDelete ? .deleted(sent.kind) : .updated(sent.kind), generation: started)
        case .notFound:
            // Gone, whoever deleted it: treated like a successful delete, and nothing comes back.
            await finish(.missing(sent.kind), generation: started)
        case .rejected(let fields):
            await rejected(fields: Set(fields.map(CaptureField.init)), error: .checkFields, sent: sent,
                           isRetry: isRetry, generation: started)
        case .rejectedGeneric:
            await rejected(fields: [], error: .couldNotSave, sent: sent, isRetry: isRetry, generation: started)
        case .uncertain:
            logger.error("A change could not be confirmed")
            phase = .uncertain
        case .sessionEnded:
            generation += 1
            resetToIdle()
        }
    }

    private func rejected(fields: Set<CaptureField>, error: FormError, sent: MutationRequest, isRetry: Bool,
                          generation started: Int) async {
        if sent.isDelete {
            // A delete has no validation; an unexpected `400` is an unknown outcome.
            phase = .uncertain
        } else if isRetry {
            // The earlier attempt may already have been applied, so never say it was not saved.
            await finish(.checkList, generation: started)
        } else {
            attempted = false
            request = nil
            phase = .editing
            fieldErrors = fields
            formError = error
            if let first = fields.min() { requestFocus(first) }
        }
    }

    /// After a known change (or a check), the list and Home are re-read from the server. Nothing is
    /// changed locally.
    private func finish(_ newNotice: Notice, generation started: Int) async {
        resetToIdle()
        notice = newNotice
        let listIsFresh = await refreshList()
        await refreshHome()
        guard generation == started, notice == newNotice else { return }
        if !listIsFresh {
            switch newNotice {
            case .updated(let kind): notice = .updatedRefreshFailed(kind)
            case .deleted(let kind): notice = .deletedRefreshFailed(kind)
            default: break
            }
        }
    }

    private func requestFocus(_ field: CaptureField) {
        focusSerial += 1
        focusRequest = FocusRequest(field: field, serial: focusSerial)
    }

    private func resetToIdle() {
        phase = .idle
        target = nil
        request = nil
        attempted = false
        isSheetPresented = false
        fieldErrors = []
        formError = nil
        draft = CaptureDraft(date: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone))
    }

    // MARK: Session hook

    /// Sign-out, a session that ended, or a fresh sign-in: drops everything, including any
    /// response still in flight, so one account never sees another's state.
    func invalidate() {
        generation += 1
        resetToIdle()
        notice = nil
    }
}
