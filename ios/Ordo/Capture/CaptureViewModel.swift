import Foundation
import Observation
import os

/// The Add expense / Add deposit flow.
///
/// A save is recorded once because of three rules:
/// 1. At the first valid Save tap, synchronously on the main actor and before any `await`, the
///    values are frozen into a `PendingSave` with one random key and persisted. Only then is the
///    request sent. From that moment the form is read-only.
/// 2. Every retry (after a timeout, a 401 refresh, or a relaunch) re-sends that same record.
/// 3. The record is removed only on a definitive outcome, a discard, sign-out or session end.
@MainActor @Observable
final class CaptureViewModel {
    enum Phase: Equatable {
        /// Nothing in progress; the Add actions are available.
        case idle
        /// The form is open and editable.
        case editing
        /// The values are frozen and the request is in flight.
        case saving
        /// The outcome is not known. Retry (same key) or discard.
        case uncertain
        /// A stored record exists but cannot be read. Discard only.
        case unreadable
    }

    /// A message shown on Home after the form closes.
    enum Notice: Equatable {
        case saved(CaptureKind)
        case savedRefreshFailed(CaptureKind)
        /// 409 `idempotency_key_record_deleted`: nothing new was saved.
        case recordDeleted
        /// 422 `idempotency_key_reused`, or a 400 on a retry: it may already be saved.
        case keyReused
    }

    enum FormError: Equatable {
        case checkFields
        case couldNotSave
        case couldNotPrepare
    }

    struct FocusRequest: Equatable {
        let field: CaptureField
        let serial: Int
    }

    private(set) var phase: Phase = .idle
    private(set) var kind: CaptureKind = .expense
    private(set) var draft: CaptureDraft
    private(set) var fieldErrors: Set<CaptureField> = []
    private(set) var formError: FormError?
    private(set) var focusRequest: FocusRequest?
    /// The frozen record while saving or uncertain.
    private(set) var pending: PendingSave?
    private(set) var notice: Notice?
    private(set) var isSheetPresented = false
    /// True when the uncertain record was found on disk after a relaunch.
    private(set) var isRecovered = false

    let language: AppLanguage
    let deviceLocale: Locale
    let timeZone: TimeZone

    @ObservationIgnored private let service: CaptureService
    @ObservationIgnored private let store: PendingSaveStore
    @ObservationIgnored private let refreshHome: @MainActor () async -> Bool
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let makeKey: @Sendable () -> String
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "capture")
    /// Incremented by anything that ends the user's context. A response that started under an
    /// older value is ignored and never touches the store or the state.
    @ObservationIgnored private var generation = 0
    /// True once a request for the current record has been started (it may have reached the server).
    @ObservationIgnored private var mayHaveReachedServer = false
    /// A record read at launch. It is surfaced only when the session was restored.
    @ObservationIgnored private var storedRecord: PendingSave?
    @ObservationIgnored private var storedUnreadable = false
    /// Set when a leftover record could not be deleted at a fresh sign-in or sign-out: it is never
    /// surfaced or sent in this run, so one account never sees another account's save.
    @ObservationIgnored private var suppressed = false
    @ObservationIgnored private var focusSerial = 0
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    init(service: CaptureService,
         store: PendingSaveStore,
         refreshHome: @escaping @MainActor () async -> Bool = { true },
         language: AppLanguage = .current,
         deviceLocale: Locale = .current,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: TimeZone = .current,
         makeKey: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }) {
        self.service = service
        self.store = store
        self.refreshHome = refreshHome
        self.language = language
        self.deviceLocale = deviceLocale
        self.now = now
        self.timeZone = timeZone
        self.makeKey = makeKey
        draft = CaptureDraft(date: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone))
    }

    // MARK: Derived state

    /// A save exists whose outcome is not definitive; new Add actions are blocked.
    var hasPending: Bool { phase == .saving || phase == .uncertain || phase == .unreadable }
    var canBegin: Bool { phase == .idle }
    /// Signing out discards the record, so the user is warned while it may already be saved.
    var needsSignOutWarning: Bool { phase == .saving || phase == .uncertain }
    var hasStoredRecord: Bool { storedRecord != nil || storedUnreadable }

    // MARK: Editing

    func begin(_ newKind: CaptureKind) {
        guard phase == .idle else { return }
        kind = newKind
        draft = CaptureDraft(date: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone))
        fieldErrors = []
        formError = nil
        notice = nil
        phase = .editing
        isSheetPresented = true
    }

    /// Applies an edit only while the form is open. Once the values are frozen, edits are ignored.
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
        phase = .idle
        isSheetPresented = false
        fieldErrors = []
        formError = nil
    }

    /// The sheet was dismissed by the system (swipe or Close). A form in progress is cancelled; a
    /// waiting save stays on the device and Home keeps offering it. A save in flight keeps its sheet.
    func sheetDismissed() {
        switch phase {
        case .editing: cancelEditing()
        case .uncertain, .unreadable: isSheetPresented = false
        case .idle, .saving: break
        }
    }

    func reopenSheet() {
        guard hasPending else { return }
        isSheetPresented = true
    }

    func dismissNotice() { notice = nil }

    // MARK: Saving

    /// Freeze, persist, then send. Everything up to the send is synchronous on the main actor, so a
    /// second tap cannot start a second save.
    func submit() {
        guard phase == .editing else { return }
        switch CaptureValidation.freeze(draft, kind: kind, key: makeKey(), createdAt: now(),
                                        language: language, deviceLocale: deviceLocale) {
        case .failure(let failure):
            fieldErrors = failure.fields
            formError = .checkFields
            if let first = failure.first {
                focusSerial += 1
                focusRequest = FocusRequest(field: first, serial: focusSerial)
            }
        case .success(let save):
            phase = .saving
            fieldErrors = []
            formError = nil
            do {
                try store.save(save)
            } catch {
                logger.error("Pending save could not be stored; nothing was sent")
                phase = .editing
                formError = .couldNotPrepare
                return
            }
            suppressed = false
            pending = save
            mayHaveReachedServer = false
            startSend(save)
        }
    }

    /// Re-sends the stored record unchanged (same key, same values).
    func retry() {
        guard phase == .uncertain, let pending else { return }
        startSend(pending)
    }

    /// Removes the waiting record. The caller has already shown the "it may already be saved" warning.
    func discard() {
        guard phase == .uncertain || phase == .unreadable else { return }
        generation += 1
        clearStore()
        resetToIdle()
    }

    private func startSend(_ save: PendingSave) {
        phase = .saving
        let isRetry = mayHaveReachedServer
        mayHaveReachedServer = true
        let started = generation
        let service = self.service
        sendTask = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.submit(save) }
            guard let self, self.generation == started else { return }
            await self.apply(outcome, for: save, isRetry: isRetry, generation: started)
        }
    }

    /// Waits for the current send (and the Home refresh that follows it). For tests.
    func settled() async { await sendTask?.value }

    // MARK: Outcomes

    enum Outcome: Equatable {
        case saved
        case notSaved(Set<ValidationField>)
        case notSavedGeneric
        case keyReused
        case recordDeleted
        case uncertain
        case sessionEnded
    }

    /// Anything not definitively classified is uncertain, the safe default.
    nonisolated static func classify(_ operation: @Sendable () async throws -> CreateResult) async -> Outcome {
        do {
            _ = try await operation()
            return .saved
        } catch let error as APIError {
            switch error {
            case .validationFailed(let fields): return .notSaved(fields)
            case .createRejected: return .notSavedGeneric
            case .keyReused: return .keyReused
            case .recordDeleted: return .recordDeleted
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }

    private func apply(_ outcome: Outcome, for save: PendingSave, isRetry: Bool, generation started: Int) async {
        switch outcome {
        case .saved:
            clearStore()
            resetToIdle()
            await finishWithNotice(.saved(save.kind), generation: started)
        case .notSaved(let fields):
            if isRetry {
                // The earlier attempt may have been recorded, so do not claim it was not saved.
                clearStore()
                resetToIdle()
                await finishWithNotice(.keyReused, generation: started)
            } else {
                clearStore()
                unlockForEditing(fieldErrors: Set(fields.map(CaptureField.init)), error: .checkFields)
            }
        case .notSavedGeneric:
            if isRetry {
                clearStore()
                resetToIdle()
                await finishWithNotice(.keyReused, generation: started)
            } else {
                clearStore()
                unlockForEditing(fieldErrors: [], error: .couldNotSave)
            }
        case .keyReused:
            clearStore()
            resetToIdle()
            await finishWithNotice(.keyReused, generation: started)
        case .recordDeleted:
            clearStore()
            resetToIdle()
            await finishWithNotice(.recordDeleted, generation: started)
        case .uncertain:
            phase = .uncertain
        case .sessionEnded:
            generation += 1
            clearStore()
            resetToIdle()
        }
    }

    /// Home is re-read from the server; nothing is added to it optimistically.
    private func finishWithNotice(_ newNotice: Notice, generation started: Int) async {
        notice = newNotice
        let refreshed = await refreshHome()
        guard generation == started, notice == newNotice else { return }
        if !refreshed, case .saved(let savedKind) = newNotice { notice = .savedRefreshFailed(savedKind) }
    }

    /// A definitive "not saved": the key is gone, so the next Save gets a new one.
    private func unlockForEditing(fieldErrors fields: Set<CaptureField>, error: FormError) {
        pending = nil
        mayHaveReachedServer = false
        phase = .editing
        fieldErrors = fields
        formError = error
        if let first = fields.min() {
            focusSerial += 1
            focusRequest = FocusRequest(field: first, serial: focusSerial)
        }
    }

    private func resetToIdle() {
        phase = .idle
        pending = nil
        storedRecord = nil
        storedUnreadable = false
        mayHaveReachedServer = false
        isRecovered = false
        isSheetPresented = false
        fieldErrors = []
        formError = nil
        draft = CaptureDraft(date: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone))
    }

    private func clearStore() {
        do { try store.clear() } catch {
            logger.error("Pending save could not be removed")
        }
    }

    // MARK: Launch and session hooks

    /// Reads the stored record at launch. It is kept but not surfaced until the session is restored.
    func loadStoredRecord() {
        switch store.load() {
        case .none: storedRecord = nil; storedUnreadable = false
        case .record(let record): storedRecord = record; storedUnreadable = false
        case .unreadable: storedRecord = nil; storedUnreadable = true
        }
    }

    /// The session was restored (not a fresh sign-in): offer the waiting save.
    func surfaceStoredRecord() {
        guard !suppressed, phase == .idle else { return }
        if let record = storedRecord {
            pending = record
            mayHaveReachedServer = true
            isRecovered = true
            phase = .uncertain
            isSheetPresented = true
        } else if storedUnreadable {
            isRecovered = true
            phase = .unreadable
            isSheetPresented = true
        }
    }

    /// Sign-out, a session that ended, or a fresh sign-in: removes the record so another account
    /// never sees or retries it, and discards any response still in flight. If the file cannot be
    /// deleted, it is suppressed for the rest of this run.
    func invalidate() {
        generation += 1
        do {
            try store.clear()
            suppressed = false
        } catch {
            logger.error("Pending save could not be removed")
            suppressed = true
        }
        resetToIdle()
        notice = nil
    }
}
