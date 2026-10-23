import SwiftUI

@main
struct OrdoApp: App {
    /// Nil when running as the unit-test host or when the server address is missing/invalid.
    private let model: AppModel?
    private let isTestHost: Bool
    /// Theme and language, saved on the device (`ordo.theme`, `ordo.language`).
    private let settings: AppSettings?

    init() {
        isTestHost = ProcessInfo.processInfo.environment["ORDO_TEST_HOST"] == "1"
        if isTestHost {
            // The test host stays inert: no session, no Keychain access, no network, no defaults.
            model = nil
            settings = nil
        } else if let configuration = AppConfiguration.load() {
            let settings = AppSettings(defaults: .standard)
            self.settings = settings
            let store = KeychainCredentialStore()
            FreshInstallGuard.apply(defaults: .standard, store: store)
            let api = OrdoAPI(baseURL: configuration.baseURL, transport: URLSessionTransport())
            model = AppModel(session: SessionManager(api: api, store: store), api: api,
                             pendingStore: FilePendingSaveStore(directory: FilePendingSaveStore.defaultDirectory),
                             settings: settings)
        } else {
            model = nil
            settings = AppSettings(defaults: .standard)
        }
    }

    var body: some Scene {
        WindowGroup {
            if isTestHost {
                Color.clear
            } else if let model {
                RootView(model: model)
                    .onOpenURL { model.handle($0) }
                    .task { await model.start() }
            } else if let settings {
                NotConfiguredView(l10n: settings.l10n)
                    .appearance(settings)
            }
        }
    }
}
