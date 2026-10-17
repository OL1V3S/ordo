import SwiftUI

@main
struct OrdoApp: App {
    /// Nil when running as the unit-test host or when the server address is missing/invalid.
    private let model: AppModel?
    private let isTestHost: Bool
    private let l10n = L10n()

    init() {
        isTestHost = ProcessInfo.processInfo.environment["ORDO_TEST_HOST"] == "1"
        if isTestHost {
            // The test host stays inert: no session, no Keychain access, no network.
            model = nil
        } else if let configuration = AppConfiguration.load() {
            let store = KeychainCredentialStore()
            FreshInstallGuard.apply(defaults: .standard, store: store)
            let api = OrdoAPI(baseURL: configuration.baseURL, transport: URLSessionTransport())
            model = AppModel(session: SessionManager(api: api, store: store), api: api)
        } else {
            model = nil
        }
    }

    var body: some Scene {
        WindowGroup {
            if isTestHost {
                Color.clear
            } else if let model {
                RootView(model: model, l10n: l10n).task { await model.start() }
            } else {
                NotConfiguredView(l10n: l10n)
            }
        }
    }
}
