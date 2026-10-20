import Foundation
import Observation

/// Bridges the `SessionManager` actor to SwiftUI and owns the screen-level view models.
@MainActor @Observable
final class AppModel {
    private(set) var sessionState: SessionState = .restoring
    let signInModel: SignInViewModel
    let homeModel: HomeViewModel
    let captureModel: CaptureViewModel
    let transactionsModel: TransactionsViewModel
    let mutationModel: TransactionMutationViewModel
    let budgetsModel: BudgetsViewModel
    let paychecksModel: PaychecksViewModel
    let recurringModel: RecurringViewModel
    let reportsModel: ReportsViewModel
    private let session: SessionManager
    private var observer: Task<Void, Never>?

    init(session: SessionManager, api: OrdoAPI, pendingStore: PendingSaveStore,
         invalidationMark: UserDefaults = .standard,
         language: AppLanguage = .current, deviceLocale: Locale = .current) {
        self.session = session
        signInModel = SignInViewModel { email, password in
            try await session.signIn(email: email, password: password)
        }
        let home = HomeViewModel(service: SessionHomeService(session: session, api: api))
        homeModel = home
        let reports = ReportsViewModel(service: SessionReportsService(session: session, api: api))
        reportsModel = reports
        let transactionsService = SessionTransactionsService(session: session, api: api)
        let transactions = TransactionsViewModel(service: transactionsService)
        transactionsModel = transactions
        let budgets = BudgetsViewModel(
            service: SessionBudgetsService(session: session, api: api),
            // Home's budget attention depends on the limits, so a budget change refreshes Home too.
            refreshHome: { [home] in await home.refresh() },
            language: language,
            deviceLocale: deviceLocale)
        budgetsModel = budgets
        let paychecks = PaychecksViewModel(
            service: SessionPaychecksService(session: session, api: api),
            // A link or a lifecycle change moves Coming Up, the paycheck marker and the deposit partition.
            refreshOthers: { [home, transactions, reports] in
                await home.refresh()
                await transactions.refreshIfLoaded()
                // A link changes the confirmed paychecks / other deposits split.
                await reports.refreshIfLoaded()
            },
            language: language,
            deviceLocale: deviceLocale)
        paychecksModel = paychecks
        let recurring = RecurringViewModel(
            service: SessionRecurringService(session: session, api: api),
            // Needs Attention evaluates change reviews of active recurring expenses.
            refreshOthers: { [home] in await home.refresh() },
            language: language,
            deviceLocale: deviceLocale)
        recurringModel = recurring
        let capture = CaptureViewModel(
            service: SessionCaptureService(session: session, api: api),
            store: pendingStore,
            invalidationMark: invalidationMark,
            refreshHome: { [home, transactions, budgets, recurring, reports] in
                await home.refresh()
                // A saved expense or deposit also appears in Transactions, once it has been opened.
                await transactions.refreshIfLoaded()
                // ... and in the month's recorded spending, once Budgets has been opened.
                await budgets.refreshSpendingIfLoaded()
                // A new deposit can be linked to a pay schedule once Paychecks has been opened.
                await paychecks.refreshIfLoaded()
                // A saved expense can start or change a possible recurring expense.
                await recurring.refreshIfLoaded()
                // ... and in the month's recorded deposits and spending, once Reports has been opened.
                await reports.refreshIfLoaded()
                if case .loaded = home.phase { return true }
                return false
            },
            language: language,
            deviceLocale: deviceLocale)
        captureModel = capture
        let mutation = TransactionMutationViewModel(
            service: transactionsService,
            refreshList: { [transactions] in await transactions.refresh(afterChange: true) },
            refreshHome: { [home, budgets, paychecks, recurring, reports] in
                await home.refresh()
                // An edited or deleted expense changes the month's recorded spending.
                await budgets.refreshSpendingIfLoaded()
                // A deleted deposit loses its paycheck link; an edited one is marked as edited.
                await paychecks.refreshIfLoaded()
                // An edited or deleted expense changes the evidence of recurring expenses.
                await recurring.refreshIfLoaded()
                // An edited or deleted expense or deposit changes the recorded figures.
                await reports.refreshIfLoaded()
            },
            isOtherWriteInFlight: { [capture, budgets, paychecks, recurring] in
                capture.phase == .saving || budgets.isWriting || paychecks.isWriting || recurring.isWriting
            },
            language: language,
            deviceLocale: deviceLocale)
        mutationModel = mutation
        // One write at a time across the app: a budget save or delete waits for a capture save or a
        // Transactions edit or delete, and the other way round.
        budgets.setOtherWriteInFlight { [capture, mutation, paychecks, recurring] in
            capture.phase == .saving || mutation.isSubmitting || paychecks.isWriting || recurring.isWriting
        }
        paychecks.setOtherWriteInFlight { [capture, mutation, budgets, recurring] in
            capture.phase == .saving || mutation.isSubmitting || budgets.isWriting || recurring.isWriting
        }
        recurring.setOtherWriteInFlight { [capture, mutation, budgets, paychecks] in
            capture.phase == .saving || mutation.isSubmitting || budgets.isWriting || paychecks.isWriting
        }
    }

    /// One write at a time: true while a save, an edit or delete, or a budget save or delete is on
    /// its way to the server. Add expense, Add deposit and a waiting save's Retry wait for it.
    var isWriteInFlight: Bool {
        captureModel.phase == .saving || mutationModel.isSubmitting || budgetsModel.isWriting
            || paychecksModel.isWriting || recurringModel.isWriting
    }

    func start() async {
        // Read the waiting save (if any) before the session starts. It is surfaced only when the
        // session is restored, and removed only by sign-out, a ended session or a fresh sign-in.
        captureModel.loadStoredRecord()
        let states = session.states
        observer = Task { @MainActor [weak self] in
            for await state in states {
                guard let self else { return }
                let previous = self.sessionState
                if state == .signedIn, previous != .signedIn {
                    self.homeModel.reset()
                    self.transactionsModel.reset()
                    self.budgetsModel.reset()
                    self.paychecksModel.reset()
                    self.recurringModel.reset()
                    self.reportsModel.reset()
                    self.mutationModel.invalidate()
                    Task { await self.homeModel.load() }
                    if previous == .restoring {
                        self.captureModel.surfaceStoredRecord()
                    } else {
                        // A fresh sign-in: a leftover save belongs to no one in this session.
                        self.captureModel.invalidate()
                    }
                } else if state != .signedIn {
                    self.homeModel.reset()
                    self.transactionsModel.reset()
                    self.budgetsModel.reset()
                    self.paychecksModel.reset()
                    self.recurringModel.reset()
                    self.reportsModel.reset()
                    self.mutationModel.invalidate()
                    // The launch-time `.signedOut(.none)` (no credential, or a transient Keychain
                    // failure) keeps the record; only an ended session clears it.
                    if state == .signedOut(.sessionEnded) { self.captureModel.invalidate() }
                }
                self.sessionState = state
            }
        }
        await session.restore()
    }

    func signOut() async {
        captureModel.invalidate()
        mutationModel.invalidate()
        transactionsModel.reset()
        budgetsModel.reset()
        paychecksModel.reset()
        recurringModel.reset()
        reportsModel.reset()
        await session.signOut()
    }
}
