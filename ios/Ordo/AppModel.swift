import Foundation
import Observation

/// Bridges the `SessionManager` actor to SwiftUI and owns the screen-level view models.
@MainActor @Observable
final class AppModel {
    private(set) var sessionState: SessionState = .restoring
    let signInModel: SignInViewModel
    let homeModel: HomeViewModel
    let captureModel: CaptureViewModel
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
        captureModel = CaptureViewModel(
            service: SessionCaptureService(session: session, api: api),
            store: pendingStore,
            invalidationMark: invalidationMark,
            refreshHome: { [home] in
                await home.refresh()
                if case .loaded = home.phase { return true }
                return false
            },
            language: language,
            deviceLocale: deviceLocale)
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
                    Task { await self.homeModel.load() }
                    if previous == .restoring {
                        self.captureModel.surfaceStoredRecord()
                    } else {
                        // A fresh sign-in: a leftover save belongs to no one in this session.
                        self.captureModel.invalidate()
                    }
                } else if state != .signedIn {
                    self.homeModel.reset()
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
        await session.signOut()
    }
}
