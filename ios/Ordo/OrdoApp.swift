import SwiftUI
import WidgetKit

@main
struct OrdoApp: App {
    /// Nil when running as the unit-test host or when the server address is missing/invalid.
    private let model: AppModel?
    private let isTestHost: Bool
    /// Theme and language, saved on the device (`ordo.theme`, `ordo.language`).
    private let settings: AppSettings?
    @Environment(\.scenePhase) private var scenePhase

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
            // The widget's access-token copy. Without a shared group in the Info.plist nothing is written.
            let widgetAccess: WidgetAccessStore = WidgetAccessLocation.load()
                .map { KeychainWidgetAccessStore(location: $0) } ?? DisabledWidgetAccessStore()
            FreshInstallGuard.apply(defaults: .standard, store: store, widgetAccess: widgetAccess)
            let api = OrdoAPI(baseURL: configuration.baseURL, transport: URLSessionTransport())
            model = AppModel(session: SessionManager(api: api, store: store, widgetAccess: widgetAccess), api: api,
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
        .onChange(of: scenePhase) { _, phase in
            // Saved captures, edits and deletes change spending: redraw the widget when leaving the app.
            if phase == .background, model != nil { WidgetCenter.shared.reloadAllTimelines() }
        }
    }
}
