import Foundation
import Observation
import os

/// The Budgets screen: a month's category limits, the spending recorded against them, and add,
/// edit and delete. A port of the web's `useBudgetLimits` and `BudgetLimitsPanel`.
///
/// ```
/// idle
///  -> adding / editing (a draft)            [Add / row Edit; needs no gate, nothing pending, limits loaded]
///  -> confirmingDelete (a row)              [row Delete -> a confirmation that names the category]
/// adding / editing --Save (valid, checked synchronously)--> pending (a frozen BudgetWrite)
/// confirmingDelete --Confirm-----------------------------> pending (a frozen BudgetWrite)
/// pending
///  -> applied (2xx upsert, 204 or 404 delete)   task closed, limits and Home re-read from the server
///       limits read ok      -> feedback saved | deleted
///       limits read failed  -> feedback savedRefreshFailed | deletedRefreshFailed, needsRefresh
///  -> 400 on an upsert                          the form stays open and unlocked, with the validation message
///  -> timeout, offline, 5xx, any other status   needsRefresh, feedback unconfirmed; the form stays open
///                                               (fields editable, Save disabled, Cancel enabled)
///  -> session ended                             everything is dropped
/// "Refresh limits": a successful read of the month's limits releases needsRefresh
/// ```
///
/// There is no "Retry the same request". After an unconfirmed change every further change is blocked
/// until the limits are read from the server again, and the user is told to check the saved limits
/// before trying again, as on the web. That makes a repeat safe without an `Idempotency-Key`:
/// the upsert is an absolute set of one value on the row keyed by owner, exact category and month
/// (or one insert), so sending the same category, limit and month again leaves the same state; the
/// delete targets a database-generated id that is never reused and is scoped to the owner, so a
/// repeat can only answer `404` for the same row, which means gone. A `401` is refused before the
/// controller runs, so the single retry after a session refresh cannot apply twice. Residual risks:
/// last write wins (a change made on another device in between is overwritten); with duplicate rows
/// the server's `FirstOrDefaultAsync` has no `OrderBy`, so a repeated upsert may update a different
/// duplicate than the first attempt did; and uniqueness is not enforced, so two overlapping inserts
/// could create a duplicate, which is then shown per the last-row rule and never repaired.
///
/// Every result is shown as the server last reported it: nothing is changed locally. Nothing is
/// persisted, and amounts, categories and ids are never logged.
@MainActor @Observable
final class BudgetsViewModel {
    enum LimitsPhase: Equatable {
        case loading
        /// The rows exactly as the server returned them (duplicates included).
        case loaded([BudgetLimitRow])
        case failed
        /// The response failed validation, so no row is shown.
        case malformed
    }

    enum SpendingPhase: Equatable {
        /// A future month: no expense can be dated in it, so every row shows `0.00` used.
        case notNeeded
        case loading
        case loaded(BudgetSpending)
        case failed
    }

    enum TaskKind: Equatable {
        case add
        case edit(BudgetLimitRow)
    }

    /// The last result, as on the web's `feedback`.
    enum Feedback: Equatable {
        case saved
        case savedRefreshFailed
        case deleted
        case deletedRefreshFailed
        case unconfirmed
        case refreshed
    }

    struct FocusRequest: Equatable {
        let field: BudgetField
        let serial: Int
    }

    private(set) var month: BudgetMonth
    private(set) var limits: LimitsPhase = .loading
    private(set) var spending: SpendingPhase = .loading
    /// The open Add or Edit form.
    private(set) var task: TaskKind?
    private(set) var draft = BudgetDraft()
    /// The row whose deletion is waiting for confirmation, or is being sent.
    private(set) var deleteTarget: BudgetLimitRow?
    /// A write is on its way to the server, or its limits are being re-read.
    private(set) var isPending = false
    /// True while the write that is pending is a delete.
    private(set) var isDeleting = false
    private(set) var feedback: Feedback?
    /// The web's `outcomeNeedsRefresh`: a change is unconfirmed until the limits are read again.
    private(set) var needsRefresh = false
    /// The form has an error message (a failed check on the phone, or a `400`).
    private(set) var showsValidation = false
    private(set) var invalidFields: Set<BudgetField> = []
    private(set) var focusRequest: FocusRequest?

    let language: AppLanguage
    let deviceLocale: Locale

    @ObservationIgnored private let service: BudgetsService
    @ObservationIgnored private let refreshHome: @MainActor () async -> Void
    @ObservationIgnored private var isOtherWriteInFlight: @MainActor () -> Bool
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let timeZone: @Sendable () -> TimeZone
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "budgets")
    /// Advanced by `reset()`. A write result that started under an older value is dropped.
    @ObservationIgnored private var generation = 0
    /// Advanced by every limits read and by `reset()`; an older read is dropped.
    @ObservationIgnored private var limitsToken = 0
    @ObservationIgnored private var spendingToken = 0
    /// True once the first read has been asked for (the Budgets tab was opened).
    @ObservationIgnored private var started = false
    /// The device day the spending cutoff was taken on.
    @ObservationIgnored private var spendingReadDay: CalendarDate?
    @ObservationIgnored private var focusSerial = 0
    @ObservationIgnored private var limitsTask: Task<Bool, Never>?
    @ObservationIgnored private var spendingTask: Task<Void, Never>?
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    /// `refreshHome` re-reads Home, whose budget attention depends on the limits.
    init(service: BudgetsService,
         refreshHome: @escaping @MainActor () async -> Void = {},
         isOtherWriteInFlight: @escaping @MainActor () -> Bool = { false },
         language: AppLanguage = .current,
         deviceLocale: Locale = .current,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: @escaping @Sendable () -> TimeZone = { TimeZone.current }) {
        self.service = service
        self.refreshHome = refreshHome
        self.isOtherWriteInFlight = isOtherWriteInFlight
        self.language = language
        self.deviceLocale = deviceLocale
        self.now = now
        self.timeZone = timeZone
        month = BudgetMonth.current(now: now(), timeZone: timeZone())
    }

    /// Sets the check for a write by another feature (a capture save, or an edit or delete of an
    /// expense or a deposit), once those exist. One write at a time across the app.
    func setOtherWriteInFlight(_ check: @escaping @MainActor () -> Bool) {
        isOtherWriteInFlight = check
    }

    // MARK: Derived state

    var today: CalendarDate { DateFormatting.localCalendarDate(now: now(), timeZone: timeZone()) }
    var currentMonth: BudgetMonth { BudgetMonth(containing: today) }
    var isCurrentMonth: Bool { month == currentMonth }

    /// A write is on its way to the server. Add expense, Add deposit and the Transactions edits wait.
    var isWriting: Bool { isPending }

    private var limitsAreLoaded: Bool {
        if case .loaded = limits { return true }
        return false
    }

    /// The rows the screen shows: the last row per exact category, in order of first appearance.
    var shownRows: [BudgetLimitRow] {
        if case .loaded(let rows) = limits { return BudgetRules.shownRows(rows) }
        return []
    }

    /// The web's `mutationDisabled`.
    var mutationDisabled: Bool {
        isPending || !limitsAreLoaded || needsRefresh || isOtherWriteInFlight()
    }
    var canChangeMonth: Bool { task == nil && deleteTarget == nil && !isPending && !needsRefresh }
    var canStepBack: Bool { canChangeMonth && month.previous != nil }
    var canStepForward: Bool { canChangeMonth && month.next != nil }
    var canGoToCurrentMonth: Bool { canChangeMonth && !isCurrentMonth }
    var canAdd: Bool { task == nil && deleteTarget == nil && !mutationDisabled }
    func canEdit(_ row: BudgetLimitRow) -> Bool { canAdd && !row.isBlankCategory }
    func canDelete(_ row: BudgetLimitRow) -> Bool { canAdd }
    /// Save is available while the form is open and nothing blocks a change.
    var canSave: Bool { task != nil && !mutationDisabled }
    var canRefreshLimits: Bool { limits != .loading && !isPending }
    var canRetrySpending: Bool { spending != .loading && !isPending }

    var isSheetPresented: Bool { task != nil }

    /// Spending is read (or not needed): rows compare against it. While it loads or after it
    /// failed, rows show "Spending unavailable".
    var spendingAvailable: Bool {
        switch spending {
        case .loaded, .notNeeded: true
        case .loading, .failed: false
        }
    }

    /// The retry for recorded spending is offered after a failed read, and when an expense without
    /// a category makes the month's spending unreadable.
    var showsSpendingRetry: Bool {
        switch spending {
        case .failed: true
        case .loaded(let spending): spending.hasBlankCategoryExpense
        case .notNeeded, .loading: false
        }
    }

    func evaluation(for row: BudgetLimitRow) -> BudgetEvaluation {
        let used: BudgetSpending.Total
        switch spending {
        case .loaded(let snapshot): used = snapshot.total(for: row.category)
        case .notNeeded: used = BudgetSpending.empty.total(for: row.category)
        case .loading, .failed: used = .needsReview
        }
        return BudgetRules.evaluate(spendingAvailable: spendingAvailable, used: used, limit: row.limit)
    }

    // MARK: Session

    /// Drops everything (sign-out, session end, sign-in): limits, spending, the form, feedback, the
    /// gate and any read or write still in flight, so one account never sees another's state.
    func reset() {
        generation += 1
        limitsToken += 1
        spendingToken += 1
        limitsTask?.cancel()
        spendingTask?.cancel()
        limitsTask = nil
        spendingTask = nil
        sendTask = nil
        started = false
        spendingReadDay = nil
        month = currentMonth
        limits = .loading
        spending = .loading
        clearTask()
        deleteTarget = nil
        isPending = false
        isDeleting = false
        feedback = nil
        needsRefresh = false
        focusRequest = nil
    }

    // MARK: Reading

    /// The first read, when the tab first appears after sign-in.
    func loadIfNeeded() async {
        guard !started else { return }
        started = true
        let spendingTask = startSpendingRead()
        let limitsTask = startLimitsRead()
        _ = await limitsTask.value
        await spendingTask.value
    }

    /// "Refresh limits": re-reads the month's limits. A successful read releases the gate that an
    /// unconfirmed change put on further changes, and says so.
    func refreshLimits() async {
        guard canRefreshLimits else { return }
        started = true
        let wasGated = needsRefresh
        guard await startLimitsRead().value else { return }
        needsRefresh = false
        feedback = wasGated ? .refreshed : nil
    }

    /// Pull to refresh: the limits and the recorded spending.
    func refresh() async {
        guard !isPending else { return }
        started = true
        let spendingTask = startSpendingRead()
        await refreshLimits()
        await spendingTask.value
    }

    /// "Try loading spending again".
    func retrySpending() async {
        guard canRetrySpending else { return }
        started = true
        await startSpendingRead().value
    }

    /// For a change made elsewhere (a saved expense, or an edited or deleted expense): the month's
    /// spending is read again, once the screen has been opened.
    func refreshSpendingIfLoaded() async {
        guard started else { return }
        await startSpendingRead().value
    }

    /// When the screen appears or the app becomes active: re-reads the spending only if the device
    /// calendar day changed since it was read, because the current month counts through today.
    func reloadIfDateChanged() async {
        guard started, let day = spendingReadDay, day != today else { return }
        await startSpendingRead().value
    }

    /// Waits for the reads and the write in flight. For tests.
    func settled() async {
        _ = await limitsTask?.value
        await spendingTask?.value
        await sendTask?.value
        _ = await limitsTask?.value
        await spendingTask?.value
    }

    @discardableResult
    private func startLimitsRead() -> Task<Bool, Never> {
        limitsToken += 1
        let token = limitsToken
        limits = .loading
        let month = self.month
        let service = self.service
        let task = Task { @MainActor [weak self] () -> Bool in
            let outcome = await Self.readLimits { try await service.loadLimits(month: month) }
            return self?.finishLimitsRead(outcome, token: token) ?? false
        }
        limitsTask = task
        return task
    }

    /// True only when this read is the latest one and its rows loaded.
    private func finishLimitsRead(_ outcome: LimitsOutcome, token: Int) -> Bool {
        guard token == limitsToken else { return false }
        limitsTask = nil
        switch outcome {
        case .rows(let rows):
            limits = .loaded(rows)
            return true
        case .malformed:
            logger.error("Budget limits failed validation")
            limits = .malformed
        case .failed:
            logger.error("Budget limits read failed")
            limits = .failed
        case .sessionEnded:
            // The app returns to sign-in; keep the state quiet.
            limits = .loading
        }
        return false
    }

    @discardableResult
    private func startSpendingRead() -> Task<Void, Never> {
        spendingToken += 1
        let token = spendingToken
        let month = self.month
        let today = self.today
        spendingReadDay = today
        guard BudgetSpendingReader.range(for: month, today: today) != nil else {
            spending = .notNeeded
            spendingTask = nil
            return Task {}
        }
        spending = .loading
        let service = self.service
        let task = Task { @MainActor [weak self] in
            let outcome = await Self.readSpending {
                try await BudgetSpendingReader.read(month: month, today: today) { try await service.loadTimelinePage($0) }
            }
            self?.finishSpendingRead(outcome, token: token)
        }
        spendingTask = task
        return task
    }

    private func finishSpendingRead(_ outcome: SpendingOutcome, token: Int) {
        guard token == spendingToken else { return }
        spendingTask = nil
        switch outcome {
        case .spending(let snapshot):
            spending = .loaded(snapshot)
        case .failed:
            logger.error("Budget spending read failed")
            spending = .failed
        case .sessionEnded:
            spending = .loading
        }
    }

    // MARK: Read outcomes

    enum LimitsOutcome: Equatable {
        case rows([BudgetLimitRow])
        case malformed
        case failed
        case sessionEnded
    }

    enum SpendingOutcome: Equatable {
        case spending(BudgetSpending)
        case failed
        case sessionEnded
    }

    nonisolated static func readLimits(_ operation: @Sendable () async throws -> [BudgetLimitRow]) async -> LimitsOutcome {
        do {
            return .rows(try await operation())
        } catch is BudgetReadError {
            return .malformed
        } catch let error as APIError {
            if case .sessionEnded = error { return .sessionEnded }
            return .failed
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .failed
        }
    }

    /// Any failure makes the whole month's spending unavailable: a partial sum is never shown.
    nonisolated static func readSpending(_ operation: @Sendable () async throws -> BudgetSpending) async -> SpendingOutcome {
        do {
            return .spending(try await operation())
        } catch let error as APIError {
            if case .sessionEnded = error { return .sessionEnded }
            return .failed
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .failed
        }
    }

    // MARK: Month

    func stepMonth(by delta: Int) {
        guard canChangeMonth, let next = month.shifted(by: delta) else { return }
        changeMonth(to: next)
    }

    func goToCurrentMonth() {
        guard canGoToCurrentMonth else { return }
        changeMonth(to: currentMonth)
    }

    /// Limits and spending for the old month are dropped by their tokens.
    private func changeMonth(to next: BudgetMonth) {
        month = next
        feedback = nil
        started = true
        startSpendingRead()
        startLimitsRead()
    }

    // MARK: Forms

    func beginAdd() {
        guard canAdd else { return }
        clearTask()
        draft = BudgetDraft()
        task = .add
    }

    /// The limit is prefilled with the stored limit's exact text, or left empty when it needs review.
    func beginEdit(_ row: BudgetLimitRow) {
        guard canEdit(row) else { return }
        clearTask()
        var next = BudgetDraft()
        if case .exact(let money) = row.limit { next.amountText = money.text }
        draft = next
        task = .edit(row)
    }

    /// Fields stay editable after an unconfirmed change; only Save is held back. Nothing changes
    /// while a request is on its way.
    func edit(_ change: (inout BudgetDraft) -> Void) {
        guard task != nil, !isPending else { return }
        let before = draft
        change(&draft)
        if draft.choice != before.choice { invalidFields.remove(.category); invalidFields.remove(.customCategory) }
        if draft.customCategory != before.customCategory { invalidFields.remove(.customCategory) }
        if draft.amountText != before.amountText { invalidFields.remove(.amount) }
        if invalidFields.isEmpty { showsValidation = false }
    }

    func cancelTask() {
        guard task != nil, !isPending else { return }
        clearTask()
    }

    /// The sheet was dismissed by the system: a form in progress is cancelled.
    func sheetDismissed() { cancelTask() }

    func beginDelete(_ row: BudgetLimitRow) {
        guard task == nil, deleteTarget == nil, canDelete(row) else { return }
        deleteTarget = row
    }

    func cancelDelete() {
        guard !isPending else { return }
        deleteTarget = nil
    }

    /// Validate, freeze, then send. Everything up to the send is synchronous on the main actor, so a
    /// second tap cannot start a second request.
    func save() {
        guard let task, canSave else { return }
        let result: Result<BudgetUpsert, BudgetValidation.Failure>
        switch task {
        case .add:
            result = BudgetValidation.add(draft, month: month, language: language, deviceLocale: deviceLocale)
        case .edit(let row):
            result = BudgetValidation.edit(storedCategory: row.category, amountText: draft.amountText, month: month,
                                           language: language, deviceLocale: deviceLocale)
        }
        switch result {
        case .failure(let failure):
            invalidFields = failure.fields
            showsValidation = true
            if let first = failure.first { requestFocus(first) }
        case .success(let upsert):
            start(BudgetWrite(operation: .upsert(upsert)))
        }
    }

    func confirmDelete() {
        guard let row = deleteTarget, task == nil, !mutationDisabled else { return }
        start(BudgetWrite(operation: .delete(id: row.id)))
    }

    private func start(_ write: BudgetWrite) {
        isPending = true
        isDeleting = write.isDelete
        feedback = nil
        showsValidation = false
        invalidFields = []
        let started = generation
        let service = self.service
        sendTask = Task { @MainActor [weak self] in
            let outcome = await Self.classify { try await service.perform(write) }
            guard let self, self.generation == started else { return }
            await self.apply(outcome, for: write, generation: started)
        }
    }

    // MARK: Outcomes

    enum WriteOutcome: Equatable {
        case applied
        case notFound
        case rejected
        case uncertain
        case sessionEnded
    }

    /// Anything not definitively classified is uncertain, the safe default: a timeout, a dropped
    /// connection, a cancellation, a `5xx`, a `404` on an upsert or any other status.
    nonisolated static func classify(_ operation: @Sendable () async throws -> MutationResult) async -> WriteOutcome {
        do {
            switch try await operation() {
            case .applied: return .applied
            case .notFound: return .notFound
            }
        } catch let error as APIError {
            switch error {
            case .budgetRejected: return .rejected
            case .sessionEnded: return .sessionEnded
            default: return .uncertain
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .uncertain
        }
    }

    private func apply(_ outcome: WriteOutcome, for write: BudgetWrite, generation started: Int) async {
        switch outcome {
        case .applied:
            await finish(write, generation: started)
        case .notFound where write.isDelete:
            // Gone, whoever deleted it: the same as a successful delete.
            await finish(write, generation: started)
        case .rejected where !write.isDelete:
            // The server refused the values: the form is open, unlocked, with the message.
            isPending = false
            isDeleting = false
            showsValidation = true
            invalidFields = []
            requestFocus(rejectedFocusField)
        case .rejected, .notFound, .uncertain:
            logger.error("A budget change could not be confirmed")
            isPending = false
            isDeleting = false
            deleteTarget = nil
            needsRefresh = true
            feedback = .unconfirmed
        case .sessionEnded:
            reset()
        }
    }

    /// After a known change, the limits are re-read from the server and Home is refreshed (its
    /// budget attention depends on the limits). Nothing is changed locally, and spending is not
    /// read again: a budget write does not change expenses.
    private func finish(_ write: BudgetWrite, generation started: Int) async {
        clearTask()
        deleteTarget = nil
        let loaded = await startLimitsRead().value
        guard generation == started else { return }
        needsRefresh = !loaded
        switch (write.isDelete, loaded) {
        case (false, true): feedback = .saved
        case (false, false): feedback = .savedRefreshFailed
        case (true, true): feedback = .deleted
        case (true, false): feedback = .deletedRefreshFailed
        }
        isPending = false
        isDeleting = false
        await refreshHome()
    }

    private var rejectedFocusField: BudgetField {
        switch task {
        case .edit: .amount
        case .add, nil: draft.choice == .other ? .customCategory : .category
        }
    }

    private func requestFocus(_ field: BudgetField) {
        focusSerial += 1
        focusRequest = FocusRequest(field: field, serial: focusSerial)
    }

    private func clearTask() {
        task = nil
        draft = BudgetDraft()
        showsValidation = false
        invalidFields = []
    }
}
