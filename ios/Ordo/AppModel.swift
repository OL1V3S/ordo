import Foundation
import Observation

/// Bridges the `SessionManager` actor to SwiftUI and owns the screen-level view models.
@MainActor @Observable
final class AppModel {
    private(set) var sessionState: SessionState = .restoring
    let signInModel: SignInViewModel
    let homeModel: HomeViewModel
    private let session: SessionManager
    private var observer: Task<Void, Never>?

    init(session: SessionManager, api: OrdoAPI) {
        self.session = session
        signInModel = SignInViewModel { email, password in
            try await session.signIn(email: email, password: password)
        }
        homeModel = HomeViewModel(service: SessionHomeService(session: session, api: api))
    }

    func start() async {
        let states = session.states
        observer = Task { @MainActor [weak self] in
            for await state in states {
                guard let self else { return }
                if state == .signedIn, self.sessionState != .signedIn {
                    self.homeModel.reset()
                    Task { await self.homeModel.load() }
                } else if state != .signedIn {
                    self.homeModel.reset()
                }
                self.sessionState = state
            }
        }
        await session.restore()
    }

    func signOut() async { await session.signOut() }
}
