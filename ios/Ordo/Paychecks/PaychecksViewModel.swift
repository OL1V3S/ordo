import Foundation
import Observation
import os

/// The Paychecks tab: the pay schedules, their lifecycle, and recording or removing a received
/// paycheck link.
///
/// ```
/// idle -> submitting                   (first valid tap: validate, freeze, send; synchronous)
/// submitting -> idle + notice          [200 / 201, then everything is read again]
/// submitting -> idle + error           [400: nothing changed; 404 and 409: read again]
/// submitting -> uncertain              [timeout, offline, connection lost, 5xx, anything unrecognised]
/// uncertain  -> submitting (Retry)     [the same frozen bytes]
/// uncertain  -> idle (Check)           [only after the schedules were read again]
/// ```
///
/// Why a retry cannot duplicate money. `POST .../receipts` has no `Idempotency-Key`; the server
/// answers a repeat of the same request (same schedule and slot, the same saved deposit or the same
/// new-deposit date, amount and description) with `200 alreadyRecorded` and writes nothing. The
/// lifecycle `PATCH` sets an absolute value and a link `DELETE` is idempotent. While a result is
/// unknown every paycheck write is blocked. Residual risks: (1) if the first attempt landed and the
/// link was then removed or the deposit deleted elsewhere, a Retry creates a new deposit, so Check
/// comes first; (2) if the schedule was paused or ended in between, a Retry answers
/// `409 paycheck_not_active` even though the first attempt landed, so a `409` on a Retry forces a
/// Check and never says "not saved"; (3) lifecycle changes are last write wins; (4) the unknown
/// state is not persisted and is lost if the app is closed (the server list is the check).
@MainActor @Observable
final class PaychecksViewModel {
    enum ListState: Equatable { case idle, loading, loaded, failed, malformed }
    enum WritePhase: Equatable { case idle, submitting, uncertain }
    enum DepositsState: Equatable { case idle, loading, loaded([SavedDeposit]), failed }
    enum LifecycleAction: Equatable, Sendable {
        case pause, reactivate, end
        var target: PaycheckLifecycle {
            switch self {
            case .pause: .paused
            case .reactivate: .active
            case .end: .ended
            }
        }
    }

    enum Notice: Equatable {
        case lifecycle, receiptRecorded, receiptRemoved
        /// The unknown outcome was resolved by reading the server.
        case checked, receiptChecked
        case refreshFailedAfterWrite
        case error(String?)
    }

    struct ReceiptSession: Equatable {
        let profileId: String
        var draft: ReceiptDraft
        var fieldErrors: Set<ReceiptField> = []
        /// A server refusal (`code`), shown in the sheet.
        var errorCode: String?
        /// The last selected slot the server listed, kept so a slot that disappears after a refresh
        /// can still be shown as "(previously selected)".
        var rememberedSlot: PaycheckSlot?
    }

    struct RemoveTarget: Equatable {
        let profileId: String
        let inflowId: Int
    }

    private(set) var listState: ListState = .idle
    private(set) var snapshot: PaychecksSnapshot?
    private(set) var isRefreshing = false
    private(set) var writePhase: WritePhase = .idle
    private(set) var frozen: PaycheckWrite?
    private(set) var notice: Notice?
    private(set) var receipt: ReceiptSession?
    private(set) var isSheetPresented = false
    private(set) var depositsState: DepositsState = .idle
    private(set) var endTarget: PaycheckProfile?
    private(set) var removeTarget: RemoveTarget?
    private(set) var expanded: Set<PaycheckLifecycle> = []
    /// The `409` code a Retry was answered with: the earlier attempt may have landed, so Check is required.
    private(set) var retryConflictCode: String?
    private(set) var isChecking = false

    let language: AppLanguage
    let deviceLocale: Locale
    let timeZone: TimeZone

    @ObservationIgnored private let service: PaychecksService
    @ObservationIgnored private let refreshOthers: @MainActor () async -> Void
    @ObservationIgnored private var isOtherWriteInFlight: @MainActor () -> Bool
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "paychecks")
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var readSerial = 0
    @ObservationIgnored private var depositsSerial = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var attempted = false
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    /// `refreshOthers` re-reads Home and Transactions (when loaded) after a change or a check.
    init(service: PaychecksService,
         refreshOthers: @escaping @MainActor () async -> Void = {},
         isOtherWriteInFlight: @escaping @MainActor () -> Bool = { false },
         language: AppLanguage = .current,
         deviceLocale: Locale = .current,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: TimeZone = .current) {
        self.service = service
        self.refreshOthers = refreshOthers
        self.isOtherWriteInFlight = isOtherWriteInFlight
        self.language = language
        self.deviceLocale = deviceLocale
        self.now = now
        self.timeZone = timeZone
    }

    func setOtherWriteInFlight(_ closure: @escaping @MainActor () -> Bool) { isOtherWriteInFlight = closure }

    // MARK: Derived state

    var isWriting: Bool { writePhase == .submitting }
    var canWrite: Bool { listState == .loaded && writePhase == .idle && !isOtherWriteInFlight() }
    var canRetry: Bool { writePhase == .uncertain && retryConflictCode == nil && !isChecking && !isOtherWriteInFlight() }
    var isReceiptFlow: Bool {
        if case .record? = frozen?.operation { return true }
        return receipt != nil
    }

    func profiles(in lifecycle: PaycheckLifecycle) -> [PaycheckProfile] {
        snapshot?.profiles.filter { $0.lifecycle == lifecycle } ?? []
    }

    func profile(id: String) -> PaycheckProfile? { snapshot?.profiles.first { $0.id == id } }

    static func actions(for lifecycle: PaycheckLifecycle) -> [LifecycleAction] {
        switch lifecycle {
        case .active: [.pause, .end]
        case .paused: [.reactivate, .end]
        case .ended: [.reactivate, .pause]
        }
    }

    var receiptProfile: PaycheckProfile? { receipt.flatMap { profile(id: $0.profileId) } }

    /// The slot the form has selected, if the server still lists it.
    var selectedSlot: PaycheckSlot? {
        guard let anchor = receipt?.draft.slotAnchor else { return nil }
        return receiptProfile?.slots.first { $0.anchor == anchor }
    }

    /// The selected date is no longer listed (a refresh removed it): Link is disabled.
    var isSlotStale: Bool { receipt != nil && selectedSlot == nil }

    var linkableDeposits: [SavedDeposit] {
        guard let snapshot, let receipt, case .loaded(let deposits) = depositsState else { return [] }
        return LinkableDeposits.list(deposits: deposits, snapshot: snapshot, search: receipt.draft.search)
    }

    var warnings: [ReceiptWarning] {
        guard let receipt, let profile = receiptProfile else { return [] }
        let draft = receipt.draft
        switch draft.source {
        case .new:
            let trimmed = draft.amountText.trimmingCharacters(in: .whitespacesAndNewlines)
            let amount: PaycheckMoney? = trimmed.isEmpty ? nil
                : AmountInput.parse(draft.amountText, language: language, deviceLocale: deviceLocale).map(PaycheckMoney.exact)
                    ?? .needsReview
            return ReceiptValidation.warnings(profile: profile, slot: selectedSlot, amount: amount, date: draft.date)
        case .existing:
            guard let id = draft.existingInflowId,
                  case .loaded(let deposits) = depositsState, let deposit = deposits.first(where: { $0.id == id }) else { return [] }
            return ReceiptValidation.warnings(profile: profile, slot: selectedSlot, amount: deposit.amount, date: deposit.date)
        }
    }

    // MARK: Reading

    func loadIfNeeded() async {
        guard !started else { return }
        started = true
        await refresh()
    }

    /// Re-reads only when the tab has been opened before (a change made elsewhere).
    func refreshIfLoaded() async {
        guard started else { return }
        await refresh()
    }

    /// Reads the schedules. The list is only ever replaced by a newer successful read; a failed read
    /// hides it, so nothing possibly stale is shown as current. Returns whether the read succeeded.
    @discardableResult
    func refresh() async -> Bool {
        started = true
        readSerial += 1
        let serial = readSerial
        let session = generation
        if snapshot == nil { listState = .loading } else { isRefreshing = true }
        defer { if serial == readSerial { isRefreshing = false } }
        do {
            let result = try await service.loadPaychecks()
            guard serial == readSerial, session == generation else { return false }
            snapshot = result
            listState = .loaded
            return true
        } catch PaychecksReadError.malformed {
            guard serial == readSerial, session == generation else { return false }
            snapshot = nil
            listState = .malformed
            logger.error("The paychecks response was not usable")
            return false
        } catch {
            guard serial == readSerial, session == generation else { return false }
            snapshot = nil
            listState = .failed
            logger.error("Paychecks could not be loaded")
            return false
        }
    }

    func loadDeposits() async {
        depositsSerial += 1
        let serial = depositsSerial
        let session = generation
        depositsState = .loading
        do {
            let rows = try await service.loadDeposits()
            guard serial == depositsSerial, session == generation else { return }
            depositsState = .loaded(rows)
        } catch {
            guard serial == depositsSerial, session == generation else { return }
            depositsState = .failed
        }
    }

    func toggleGroup(_ lifecycle: PaycheckLifecycle) {
        if expanded.contains(lifecycle) { expanded.remove(lifecycle) } else { expanded.insert(lifecycle) }
    }

    func dismissNotice() { notice = nil }

    // MARK: Lifecycle

    func perform(_ action: LifecycleAction, on profile: PaycheckProfile) {
        guard canWrite, Self.actions(for: profile.lifecycle).contains(action) else { return }
        if action == .end {
            notice = nil
            endTarget = profile
        } else {
            startLifecycle(profile, action.target)
        }
    }

    /// Confirms ending the schedule the dialog presented (so it does not depend on `endTarget`
    /// still being set when the button's action runs).
    func confirmEnd(_ profile: PaycheckProfile) {
        endTarget = nil
        guard canWrite else { return }
        startLifecycle(profile, .ended)
    }

    func cancelEnd() { endTarget = nil }

    private func startLifecycle(_ profile: PaycheckProfile, _ value: PaycheckLifecycle) {
        notice = nil
        start(PaycheckWrite(operation: .lifecycle(id: profile.id, value: value, body: PaycheckRequestBody.lifecycle(value))),
              isRetry: false)
    }

    // MARK: Remove a link

    func beginRemove(_ profile: PaycheckProfile, _ evidence: PaycheckEvidence) {
        guard canWrite, evidence.isRemovable else { return }
        notice = nil
        removeTarget = RemoveTarget(profileId: profile.id, inflowId: evidence.accountInflowId)
    }

    func confirmRemove(_ target: RemoveTarget) {
        removeTarget = nil
        guard canWrite else { return }
        notice = nil
        start(PaycheckWrite(operation: .removeReceipt(id: target.profileId, inflowId: target.inflowId)), isRetry: false)
    }

    func cancelRemove() { removeTarget = nil }

    // MARK: Record a received paycheck

    func beginReceipt(_ profile: PaycheckProfile) {
        guard canWrite, receipt == nil, profile.canLinkDeposit else { return }
        notice = nil
        receipt = ReceiptSession(profileId: profile.id,
                                 draft: ReceiptDraft.initial(for: profile, today: DateFormatting.localCalendarDate(now: now(), timeZone: timeZone)),
                                 rememberedSlot: profile.slots.first)
        depositsState = .idle
        isSheetPresented = true
    }

    func editReceipt(_ mutate: (inout ReceiptDraft) -> Void) {
        guard writePhase == .idle, var session = receipt else { return }
        let before = session.draft
        mutate(&session.draft)
        if session.draft.descriptionText != before.descriptionText { session.fieldErrors.remove(.description) }
        if session.draft.amountText != before.amountText { session.fieldErrors.remove(.amount) }
        if session.draft.date != before.date { session.fieldErrors.remove(.date) }
        session.errorCode = nil
        if let slot = receiptProfile?.slots.first(where: { $0.anchor == session.draft.slotAnchor }) {
            session.rememberedSlot = slot
        }
        receipt = session
        if before.source != .existing, session.draft.source == .existing, depositsState == .idle || depositsState == .failed {
            Task { await loadDeposits() }
        }
    }

    func cancelReceipt() {
        guard writePhase == .idle else { return }
        closeTask()
    }

    /// The system dismissed the sheet. A form in progress is cancelled; an unknown outcome stays,
    /// and the list keeps offering Retry and Check.
    func sheetDismissed() {
        switch writePhase {
        case .idle: closeTask()
        case .uncertain: isSheetPresented = false
        case .submitting: break
        }
    }

    /// Validates, freezes and sends; synchronous up to the send, so a second tap is refused.
    func submitReceipt() {
        guard canWrite, var session = receipt, let profile = receiptProfile, profile.canLinkDeposit,
              let slot = selectedSlot else { return }
        switch session.draft.source {
        case .new:
            switch ReceiptValidation.validateNew(session.draft, language: language, deviceLocale: deviceLocale) {
            case .failure(let failure):
                session.fieldErrors = failure.fields
                receipt = session
            case .success(let values):
                guard let body = try? PaycheckRequestBody.recordNew(description: values.description, amount: values.amount,
                                                                    date: session.draft.date, slot: slot.anchor) else { return }
                start(PaycheckWrite(operation: .record(id: profile.id, body: body)), isRetry: false)
            }
        case .existing:
            guard let id = session.draft.existingInflowId, linkableDeposits.contains(where: { $0.id == id }) else { return }
            start(PaycheckWrite(operation: .record(id: profile.id,
                                                    body: PaycheckRequestBody.recordExisting(inflowId: id, slot: slot.anchor))),
                  isRetry: false)
        }
    }

    // MARK: Sending

    private func start(_ write: PaycheckWrite, isRetry: Bool) {
        frozen = write
        writePhase = .submitting
        retryConflictCode = nil
        if var session = receipt { session.errorCode = nil; receipt = session }
        let retrying = isRetry
        attempted = true
        let started = generation
        let service = self.service
        sendTask = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.perform(write) }
            guard let self, self.generation == started else { return }
            await self.apply(outcome, for: write, isRetry: retrying, generation: started)
        }
    }

    func settled() async { await sendTask?.value }

    enum Outcome: Equatable {
        case applied
        case refused(String?)
        case notFound
        case conflict(String?)
        case uncertain
        case sessionEnded
    }

    /// Anything not definitively classified is uncertain, the safe default.
    nonisolated static func classify(_ operation: @Sendable () async throws -> Void) async -> Outcome {
        do {
            try await operation()
            return .applied
        } catch let error as APIError {
            switch error {
            case .paycheckRejected(let code): return .refused(code)
            case .paycheckNotFound: return .notFound
            case .paycheckConflict(let code): return .conflict(code)
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }

    private func apply(_ outcome: Outcome, for write: PaycheckWrite, isRetry: Bool, generation started: Int) async {
        switch outcome {
        case .applied:
            if case .lifecycle(_, let value, _) = write.operation { expanded.insert(value) }
            await finish(Self.successNotice(write), generation: started)
        case .refused(let code):
            // A definitive refusal: nothing changed and the form is editable again.
            resolveWrite()
            show(error: code)
        case .notFound:
            resolveWrite()
            closeTask()
            notice = .error("paycheck_not_found")
            await readAgain()
        case .conflict(let code):
            if isRetry {
                // The first attempt may have landed (`paycheck_not_active` is checked before the exact
                // retry match), so this is never reported as "not saved": Check is required.
                retryConflictCode = code ?? "request_failed"
                writePhase = .uncertain
            } else {
                resolveWrite()
                if code == "paycheck_not_active" || receipt == nil {
                    closeTask()
                    notice = .error(code)
                } else {
                    show(error: code)
                }
                await readAgain()
                if generation == started, receipt != nil, receipt?.draft.source == .existing { await loadDeposits() }
            }
        case .uncertain:
            logger.error("A paycheck change could not be confirmed")
            writePhase = .uncertain
        case .sessionEnded:
            generation += 1
            resetState()
        }
    }

    private static func successNotice(_ write: PaycheckWrite) -> Notice {
        switch write.operation {
        case .lifecycle: .lifecycle
        case .record: .receiptRecorded
        case .removeReceipt: .receiptRemoved
        }
    }

    private func show(error code: String?) {
        if var session = receipt {
            session.errorCode = code ?? "request_failed"
            receipt = session
        } else {
            notice = .error(code)
        }
    }

    private func resolveWrite() {
        writePhase = .idle
        frozen = nil
        attempted = false
        retryConflictCode = nil
    }

    private func readAgain() async {
        await refresh()
        await refreshOthers()
    }

    /// After a known change nothing is changed locally: the schedules, Home and Transactions are read again.
    private func finish(_ newNotice: Notice, generation started: Int) async {
        resolveWrite()
        closeTask()
        notice = newNotice
        let fresh = await refresh()
        await refreshOthers()
        guard generation == started, notice == newNotice else { return }
        if !fresh { notice = .refreshFailedAfterWrite }
    }

    /// Resolves an unknown outcome by reading the server. Retry is not needed once the list is read.
    func check() async {
        guard writePhase == .uncertain, !isChecking else { return }
        let started = generation
        let wasReceipt = isReceiptFlow
        isChecking = true
        defer { isChecking = false }
        let fresh = await refresh()
        guard generation == started else { return }
        guard fresh else { return }
        await refreshOthers()
        guard generation == started else { return }
        resolveWrite()
        closeTask()
        notice = wasReceipt ? .receiptChecked : .checked
    }

    /// Re-sends the frozen write unchanged.
    func retry() {
        guard writePhase == .uncertain, canRetry, let frozen else { return }
        start(frozen, isRetry: true)
    }

    private func closeTask() {
        receipt = nil
        isSheetPresented = false
        endTarget = nil
        removeTarget = nil
        depositsState = .idle
        depositsSerial += 1
    }

    private func resetState() {
        readSerial += 1
        snapshot = nil
        listState = .idle
        isRefreshing = false
        started = false
        notice = nil
        expanded = []
        resolveWrite()
        closeTask()
    }

    // MARK: Session hook

    /// Sign-out, an ended session or a fresh sign-in: drops everything, including a response still in flight.
    func reset() {
        generation += 1
        resetState()
    }
}
