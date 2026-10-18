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
        let capture = CaptureViewModel(
            service: SessionCaptureService(session: session, api: api),
            store: pendingStore,
            invalidationMark: invalidationMark,
            refreshHome: { [home, transactions] in
                await home.refresh()
                // A saved expense or deposit also appears in Transactions, once it has been opened.
                await transactions.refreshIfLoaded()
                if case .loaded = home.phase { return true }
                return false
            },
            language: language,
            deviceLocale: deviceLocale)
        captureModel = capture
        mutationModel = TransactionMutationViewModel(
            service: transactionsService,
            refreshList: { [transactions] in await transactions.refresh(afterChange: true) },
            refreshHome: { [home] in await home.refresh() },
            isOtherWriteInFlight: { [capture] in capture.phase == .saving },
            language: language,
            deviceLocale: deviceLocale)
    }

    /// One write at a time: true while a save or an edit or delete is on its way to the server.
    /// Add expense, Add deposit and a waiting save's Retry wait for it.
    var isWriteInFlight: Bool { captureModel.phase == .saving || mutationModel.isSubmitting }

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
        await session.signOut()
    }
}
