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
        let capture = CaptureViewModel(
            service: SessionCaptureService(session: session, api: api),
            store: pendingStore,
            invalidationMark: invalidationMark,
            refreshHome: { [home, transactions, budgets] in
                await home.refresh()
                // A saved expense or deposit also appears in Transactions, once it has been opened.
                await transactions.refreshIfLoaded()
                // ... and in the month's recorded spending, once Budgets has been opened.
                await budgets.refreshSpendingIfLoaded()
                if case .loaded = home.phase { return true }
                return false
            },
            language: language,
            deviceLocale: deviceLocale)
        captureModel = capture
        let mutation = TransactionMutationViewModel(
            service: transactionsService,
            refreshList: { [transactions] in await transactions.refresh(afterChange: true) },
            refreshHome: { [home, budgets] in
                await home.refresh()
                // An edited or deleted expense changes the month's recorded spending.
                await budgets.refreshSpendingIfLoaded()
            },
            isOtherWriteInFlight: { [capture, budgets] in capture.phase == .saving || budgets.isWriting },
            language: language,
            deviceLocale: deviceLocale)
        mutationModel = mutation
        // One write at a time across the app: a budget save or delete waits for a capture save or a
        // Transactions edit or delete, and the other way round.
        budgets.setOtherWriteInFlight { [capture, mutation] in capture.phase == .saving || mutation.isSubmitting }
    }

    /// One write at a time: true while a save, an edit or delete, or a budget save or delete is on
    /// its way to the server. Add expense, Add deposit and a waiting save's Retry wait for it.
    var isWriteInFlight: Bool {
        captureModel.phase == .saving || mutationModel.isSubmitting || budgetsModel.isWriting
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
        await session.signOut()
    }
}
