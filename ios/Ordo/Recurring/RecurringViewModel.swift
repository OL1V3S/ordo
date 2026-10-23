import Foundation
import Observation
import os

/// The Recurring expenses tab: confirmed recurring expenses, possible ones to review, and the
/// decisions on them (confirm, dismiss, review again, pause, reactivate, end).
///
/// ```
/// idle -> submitting                   (first valid tap: validate, freeze, send; synchronous)
/// submitting -> idle + notice          [200 / 201 / 204, then everything is read again]
/// submitting -> idle + error           [400 / 422: nothing changed; 404 and 409: read again]
/// submitting -> uncertain              [timeout, offline, connection lost, 5xx, anything unrecognised]
/// uncertain  -> submitting (Retry)     [the same frozen bytes]
/// uncertain  -> idle (Check)           [only after the lists were read again]
/// ```
///
/// Why a retry cannot duplicate a recurring expense. `POST .../confirm` has no `Idempotency-Key`; the
/// server looks up the owner's commitment by its origin fingerprint first, inside a serializable
/// transaction, and answers a repeat with `200 alreadyConfirmed` without writing, and no endpoint can
/// delete a commitment. Dismiss and review again answer `204` when already in the target state; the
/// lifecycle `PATCH` and the edit `PUT` set absolute values (a repeated edit is safe). While a result is unknown every recurring-expense write
/// is blocked. Residual risks: (1) a Retry that arrives while the first request still runs can answer
/// `409 confirmation_conflict` even though the first then commits; (2) a dismiss or review again
/// Retry answers `409 candidate_changed` when the matching expenses changed in between, whether or
/// not the first attempt landed; so a `409` on a Retry forces a Check and never says "not saved";
/// (3) lifecycle changes are last write wins; (4) the unknown state is not persisted and is lost if
/// the app is closed (the server lists are the check).
@MainActor @Observable
final class RecurringViewModel {
    enum ListState: Equatable { case idle, loading, loaded, failed, malformed }
    enum WritePhase: Equatable { case idle, submitting, uncertain }
    enum Group: Hashable, Sendable { case paused, ended, dismissed, reviewedChanges }
    enum LifecycleAction: Equatable, Sendable {
        case pause, reactivate, end
        var target: CommitmentLifecycle {
            switch self {
            case .pause: .paused
            case .reactivate: .active
            case .end: .ended
            }
        }
    }

    enum Notice: Equatable {
        case confirmed, dismissed, reconsidered, lifecycle, updated
        case amountAccepted, timingAccepted, markedEnded, keptActive, keptCurrent, changeReconsidered
        /// The unknown outcome was resolved by reading the server.
        case checked
        case refreshFailedAfterWrite
        case error(String?)
    }

    /// The form session: reviewing a possible recurring expense or editing a saved one.
    struct ConfirmSession: Equatable {
        let target: CommitmentFormTarget
        var draft: ConfirmDraft
        var fieldErrors: Set<ConfirmField> = []
        /// A server refusal (`code`), shown in the sheet.
        var errorCode: String?
    }

    private(set) var listState: ListState = .idle
    private(set) var snapshot: RecurringSnapshot?
    private(set) var isRefreshing = false
    private(set) var writePhase: WritePhase = .idle
    private(set) var frozen: CommitmentWrite?
    private(set) var notice: Notice?
    private(set) var confirm: ConfirmSession?
    private(set) var isSheetPresented = false
    private(set) var endTarget: RecurringCommitment?
    /// The change review, read independently of the lists: it can fail alone, and then nothing in it can be decided.
    private(set) var changes: CommitmentChangesSnapshot?
    private(set) var changesFailed = false
    private(set) var changeEndTarget: ChangeEndTarget?
    private(set) var expanded: Set<Group> = []
    /// The `409` code a Retry was answered with: the earlier attempt may have landed, so Check is required.
    private(set) var retryConflictCode: String?
    private(set) var isChecking = false

    /// Changed by `AppModel.setLanguage` (only while no write is in flight).
    var language: AppLanguage
    let deviceLocale: Locale

    @ObservationIgnored private let service: RecurringService
    @ObservationIgnored private let refreshOthers: @MainActor () async -> Void
    @ObservationIgnored private var isOtherWriteInFlight: @MainActor () -> Bool
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "recurring")
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var readSerial = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    /// `refreshOthers` re-reads Home (Needs Attention evaluates change reviews of active recurring
    /// expenses) after a change or a check.
    init(service: RecurringService,
         refreshOthers: @escaping @MainActor () async -> Void = {},
         isOtherWriteInFlight: @escaping @MainActor () -> Bool = { false },
         language: AppLanguage = .current,
         deviceLocale: Locale = .current) {
        self.service = service
        self.refreshOthers = refreshOthers
        self.isOtherWriteInFlight = isOtherWriteInFlight
        self.language = language
        self.deviceLocale = deviceLocale
    }

    func setOtherWriteInFlight(_ closure: @escaping @MainActor () -> Bool) { isOtherWriteInFlight = closure }

    // MARK: Derived state

    var isWriting: Bool { writePhase == .submitting }
    var canWrite: Bool { listState == .loaded && writePhase == .idle && !isOtherWriteInFlight() }
    /// Decisions on changes also need the changes read, so they never act on a stale or missing proposal.
    var canDecideChanges: Bool { canWrite && changes != nil && !changesFailed }
    var canRetry: Bool { writePhase == .uncertain && retryConflictCode == nil && !isChecking && !isOtherWriteInFlight() }

    func commitments(in lifecycle: CommitmentLifecycle) -> [RecurringCommitment] {
        snapshot?.commitments.filter { $0.lifecycle == lifecycle } ?? []
    }

    func commitment(id: String) -> RecurringCommitment? { snapshot?.commitments.first { $0.id == id } }

    /// A possible recurring expense by fingerprint, whether to review or dismissed.
    func candidate(fingerprint: String) -> RecurringCandidate? {
        snapshot?.candidates.first { $0.fingerprint == fingerprint }
            ?? snapshot?.dismissed.first { $0.fingerprint == fingerprint }
    }

    static func actions(for lifecycle: CommitmentLifecycle) -> [LifecycleAction] {
        switch lifecycle {
        case .active: [.pause, .end]
        case .paused: [.reactivate, .end]
        case .ended: [.reactivate, .pause]
        }
    }

    /// Whether the session's possible or saved recurring expense is still in the lists just read.
    var isFormTargetListed: Bool {
        guard let target = confirm?.target else { return false }
        switch target {
        case .candidate(let fingerprint): return snapshot?.candidates.contains { $0.fingerprint == fingerprint } == true
        case .commitment(let id): return commitment(id: id) != nil
        }
    }

    var isEditing: Bool {
        if case .commitment? = confirm?.target { return true }
        return false
    }

    /// The form sheet shows its form (and, while a write is unresolved, the shared Retry/Check panel)
    /// whenever its target is present or a write is submitting/uncertain; only an idle session whose
    /// target is gone shows the "changed" placeholder, so a failed read never hides Retry/Check.
    var showsConfirmForm: Bool { confirm != nil && (isFormTargetListed || writePhase != .idle) }

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

    /// Reads both lists. They are only ever replaced by a newer successful read; a failed read hides
    /// them, so nothing possibly stale is shown as current. Returns whether the read succeeded.
    @discardableResult
    func refresh(requireChanges: Bool = false) async -> Bool {
        started = true
        readSerial += 1
        let serial = readSerial
        let session = generation
        if snapshot == nil { listState = .loading } else { isRefreshing = true }
        defer { if serial == readSerial { isRefreshing = false } }
        async let changesRead = Self.readChanges(service)
        do {
            let result = try await service.load()
            let changesResult = await changesRead
            guard serial == readSerial, session == generation else { return false }
            snapshot = result
            listState = .loaded
            switch changesResult {
            case .success(let value):
                changes = value
                changesFailed = false
            case .failure:
                changes = nil
                changesFailed = true
                logger.error("Recurring expense changes could not be loaded")
            }
            reconcile()
            return !requireChanges || !changesFailed
        } catch RecurringReadError.malformed {
            guard serial == readSerial, session == generation else { return false }
            snapshot = nil
            changes = nil
            changesFailed = false
            listState = .malformed
            reconcile()
            logger.error("The recurring expenses response was not usable")
            return false
        } catch {
            guard serial == readSerial, session == generation else { return false }
            snapshot = nil
            changes = nil
            changesFailed = false
            listState = .failed
            reconcile()
            logger.error("Recurring expenses could not be loaded")
            return false
        }
    }

    nonisolated private static func readChanges(_ service: RecurringService) async -> Result<CommitmentChangesSnapshot, Error> {
        do { return .success(try await service.loadChanges()) } catch { return .failure(error) }
    }

    /// After a read: the End confirmation closes when the presented recurring expense is gone or its
    /// status changed underneath it; an idle confirm sheet closes when its possible recurring expense
    /// is no longer listed to review, and a refusal it was showing becomes the visible notice.
    private func reconcile() {
        if let target = endTarget {
            if let current = snapshot?.commitments.first(where: { $0.id == target.id }), current.lifecycle == target.lifecycle {
                // unchanged
            } else {
                endTarget = nil
            }
        }
        if let target = changeEndTarget {
            let pending = changes?.change(id: target.commitmentId)?.assessment(id: target.assessmentId)
            if pending?.decision != .pending { changeEndTarget = nil }
        }
        if writePhase == .idle, let session = confirm {
            // An edit keeps the user's draft unless the lists were read and the expense is truly gone.
            let gone: Bool
            switch session.target {
            case .candidate: gone = !isFormTargetListed
            case .commitment: gone = snapshot != nil && !isFormTargetListed
            }
            if gone {
                if let code = session.errorCode { notice = .error(code) }
                closeTask()
            }
        }
    }

    func toggleGroup(_ group: Group) {
        if expanded.contains(group) { expanded.remove(group) } else { expanded.insert(group) }
    }

    func dismissNotice() { notice = nil }

    // MARK: Lifecycle

    func perform(_ action: LifecycleAction, on commitment: RecurringCommitment) {
        guard canWrite, commitment.lifecycle == self.commitment(id: commitment.id)?.lifecycle,
              Self.actions(for: commitment.lifecycle).contains(action) else { return }
        if action == .end {
            notice = nil
            endTarget = commitment
        } else {
            startLifecycle(commitment, action.target)
        }
    }

    /// Confirms ending the recurring expense the dialog presented (so it does not depend on
    /// `endTarget` still being set when the button's action runs).
    func confirmEnd(_ commitment: RecurringCommitment) {
        endTarget = nil
        guard canWrite, self.commitment(id: commitment.id)?.lifecycle == commitment.lifecycle else { return }
        startLifecycle(commitment, .ended)
    }

    func cancelEnd() { endTarget = nil }

    private func startLifecycle(_ commitment: RecurringCommitment, _ value: CommitmentLifecycle) {
        notice = nil
        start(CommitmentWrite(operation: .lifecycle(id: commitment.id, value: value,
                                                     body: CommitmentRequestBody.lifecycle(value))), isRetry: false)
    }

    // MARK: Dismiss and review again

    func dismiss(_ candidate: RecurringCandidate) {
        guard canWrite, snapshot?.candidates.contains(where: { $0.fingerprint == candidate.fingerprint }) == true else { return }
        notice = nil
        start(CommitmentWrite(operation: .dismiss(fingerprint: candidate.fingerprint,
                                                  body: CommitmentRequestBody.fingerprint(candidate.fingerprint))), isRetry: false)
    }

    func reconsider(_ candidate: RecurringCandidate) {
        guard canWrite, snapshot?.dismissed.contains(where: { $0.fingerprint == candidate.fingerprint }) == true else { return }
        notice = nil
        start(CommitmentWrite(operation: .reconsider(fingerprint: candidate.fingerprint,
                                                     body: CommitmentRequestBody.fingerprint(candidate.fingerprint))), isRetry: false)
    }

    // MARK: Change review

    /// Starts a decision on one assessment, or opens the Mark as ended confirmation. Refused unless
    /// the changes are loaded, no write is in flight and the assessment is still shown with this
    /// decision (an amount assessment that is not exact offers none).
    func decide(_ decision: ChangeDecision, commitmentId: String, assessmentId: String) {
        guard canDecideChanges, ChangeWrites.make(decision, commitmentId: commitmentId, assessmentId: assessmentId,
                                                  in: changes) != nil else { return }
        notice = nil
        if decision == .markEnded {
            if let change = changes?.change(id: commitmentId) {
                changeEndTarget = ChangeEndTarget(commitmentId: commitmentId, assessmentId: assessmentId, name: change.commitment.name)
            }
        } else if let write = ChangeWrites.make(decision, commitmentId: commitmentId, assessmentId: assessmentId, in: changes) {
            start(write, isRetry: false)
        }
    }

    /// Confirms the Mark as ended dialog for the change it presented.
    func confirmChangeEnd(_ target: ChangeEndTarget) {
        changeEndTarget = nil
        guard canDecideChanges, let write = ChangeWrites.make(.markEnded, commitmentId: target.commitmentId,
                                                              assessmentId: target.assessmentId, in: changes) else { return }
        start(write, isRetry: false)
    }

    func cancelChangeEnd() { changeEndTarget = nil }

    // MARK: Review and confirm

    func beginConfirm(_ candidate: RecurringCandidate) {
        guard canWrite, confirm == nil, snapshot?.candidates.contains(where: { $0.fingerprint == candidate.fingerprint }) == true else { return }
        notice = nil
        confirm = ConfirmSession(target: .candidate(fingerprint: candidate.fingerprint), draft: ConfirmDraft.initial(for: candidate))
        isSheetPresented = true
    }

    /// Opens the same form for a saved recurring expense (active, paused or ended).
    func beginEdit(_ commitment: RecurringCommitment) {
        guard canWrite, confirm == nil, self.commitment(id: commitment.id) != nil else { return }
        notice = nil
        confirm = ConfirmSession(target: .commitment(id: commitment.id), draft: ConfirmDraft.initial(for: commitment))
        isSheetPresented = true
    }

    func editConfirm(_ mutate: (inout ConfirmDraft) -> Void) {
        guard writePhase == .idle, var session = confirm else { return }
        let before = session.draft
        mutate(&session.draft)
        if session.draft.name != before.name { session.fieldErrors.remove(.name) }
        if session.draft.category != before.category { session.fieldErrors.remove(.category) }
        if session.draft.cadence != before.cadence || session.draft.monthlyTiming != before.monthlyTiming
            || session.draft.weekday != before.weekday || session.draft.monthText != before.monthText
            || session.draft.dayText != before.dayText || session.draft.beforeText != before.beforeText
            || session.draft.afterText != before.afterText { session.fieldErrors.remove(.timing) }
        if session.draft.amountMode != before.amountMode || session.draft.expectedText != before.expectedText
            || session.draft.minimumText != before.minimumText || session.draft.maximumText != before.maximumText {
            session.fieldErrors.remove(.amount)
        }
        session.errorCode = nil
        confirm = session
    }

    func cancelConfirm() {
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
    func submitConfirm() {
        guard canWrite, var session = confirm, isFormTargetListed else { return }
        switch session.draft.validate(language: language, deviceLocale: deviceLocale) {
        case .failure(let failure):
            session.fieldErrors = failure.fields
            confirm = session
        case .success(let values):
            switch session.target {
            case .candidate(let fingerprint):
                guard let body = try? CommitmentRequestBody.confirm(fingerprint: fingerprint, values.body) else { return }
                start(CommitmentWrite(operation: .confirm(fingerprint: fingerprint, body: body)), isRetry: false)
            case .commitment(let id):
                guard let body = try? CommitmentRequestBody.update(values.body) else { return }
                start(CommitmentWrite(operation: .update(id: id, body: body)), isRetry: false)
            }
        }
    }

    // MARK: Sending

    func start(_ write: CommitmentWrite, isRetry: Bool) {
        frozen = write
        writePhase = .submitting
        retryConflictCode = nil
        if var session = confirm { session.errorCode = nil; confirm = session }
        let retrying = isRetry
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
            case .commitmentRejected(let code): return .refused(code)
            case .commitmentNotFound: return .notFound
            case .commitmentConflict(let code): return .conflict(code)
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }

    private func apply(_ outcome: Outcome, for write: CommitmentWrite, isRetry: Bool, generation started: Int) async {
        switch outcome {
        case .applied:
            switch write.operation {
            case .lifecycle(_, let value, _): if value != .active { expanded.insert(value == .paused ? .paused : .ended) }
            case .dismiss: expanded.insert(.dismissed)
            case .change(_, _, let decision, _, _):
                if decision == .keep { expanded.insert(.reviewedChanges) }
                if decision == .markEnded { expanded.insert(.ended) }
            case .confirm, .reconsider, .update: break
            }
            await finish(Self.successNotice(write), requireChanges: write.operation.isChangeDecision, generation: started)
        case .refused(let code):
            // A definitive refusal: nothing changed and the form is editable again.
            resolveWrite()
            show(error: code, for: write)
            // A refused change decision (400 / 422) changes nothing and reads nothing again.
            if code == "fingerprint_invalid", !write.operation.isChangeDecision { await readAgain() }
        case .notFound:
            resolveWrite()
            closeTask()
            notice = .error("commitment_not_found")
            await readAgain()
        case .conflict(let code):
            if isRetry {
                // The first attempt may have landed (the candidate can have changed since), so this is
                // never reported as "not saved": Check is required.
                retryConflictCode = code ?? "request_failed"
                writePhase = .uncertain
            } else {
                resolveWrite()
                show(error: code, for: write)
                // Only a changed proposal is read again for a change decision.
                if !write.operation.isChangeDecision || code == "change_proposal_changed" { await readAgain() }
            }
        case .uncertain:
            logger.error("A recurring expense change could not be confirmed")
            writePhase = .uncertain
        case .sessionEnded:
            generation += 1
            resetState()
        }
    }

    private static func successNotice(_ write: CommitmentWrite) -> Notice {
        switch write.operation {
        case .confirm: .confirmed
        case .dismiss: .dismissed
        case .reconsider: .reconsidered
        case .lifecycle: .lifecycle
        case .update: .updated
        case .change(_, let dimension, let decision, _, _):
            switch decision {
            case .accept: dimension == .amount ? .amountAccepted : .timingAccepted
            case .markEnded: .markedEnded
            case .keep: dimension == .missing ? .keptActive : .keptCurrent
            case .reconsider: .changeReconsidered
            }
        }
    }

    /// A definitive error goes to the open form sheet; the draft stays. An edit whose sheet was swiped
    /// away after an unknown outcome opens it again with the error, so the user's changes are never
    /// lost. When a confirm's sheet is not presented, or the write was not a form write, the confirm
    /// state is cleared and the error is shown as the visible notice, so the outcome is never dropped
    /// and Review and confirm works again.
    private func show(error code: String?, for write: CommitmentWrite) {
        if case .update = write.operation, var session = confirm {
            session.errorCode = code ?? "request_failed"
            confirm = session
            isSheetPresented = true
        } else if case .confirm = write.operation, var session = confirm, isSheetPresented {
            session.errorCode = code ?? "request_failed"
            confirm = session
        } else {
            if case .confirm = write.operation { closeTask() }
            notice = .error(code)
        }
    }

    private func resolveWrite() {
        writePhase = .idle
        frozen = nil
        retryConflictCode = nil
    }

    private func readAgain() async {
        await refresh()
        await refreshOthers()
    }

    /// After a known change nothing is changed locally: both lists and Home are read again.
    private func finish(_ newNotice: Notice, requireChanges: Bool, generation started: Int) async {
        resolveWrite()
        closeTask()
        notice = newNotice
        let fresh = await refresh(requireChanges: requireChanges)
        await refreshOthers()
        guard generation == started, notice == newNotice else { return }
        if !fresh { notice = .refreshFailedAfterWrite }
    }

    /// Resolves an unknown outcome by reading the server. Retry is not needed once the lists are read.
    func check() async {
        guard writePhase == .uncertain, !isChecking else { return }
        let started = generation
        isChecking = true
        defer { isChecking = false }
        // A change decision is only resolved by reading the changes again.
        let fresh = await refresh(requireChanges: frozen?.operation.isChangeDecision == true)
        guard generation == started else { return }
        guard fresh else { return }
        await refreshOthers()
        guard generation == started else { return }
        resolveWrite()
        closeTask()
        notice = .checked
    }

    /// Re-sends the frozen write unchanged.
    func retry() {
        guard writePhase == .uncertain, canRetry, let frozen else { return }
        start(frozen, isRetry: true)
    }

    private func closeTask() {
        confirm = nil
        isSheetPresented = false
        endTarget = nil
        changeEndTarget = nil
    }

    private func resetState() {
        readSerial += 1
        snapshot = nil
        changes = nil
        changesFailed = false
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
