import Foundation
import Testing
@testable import Ordo

private let createPath = "/api/auth/device-sessions"
private let limitsPath = "/api/budgetlimits"

private func source(_ relative: String) throws -> String {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    return try String(contentsOf: root.appendingPathComponent(relative), encoding: .utf8)
}

private func swiftFiles(_ directory: String) throws -> [String] {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let url = root.appendingPathComponent(directory, isDirectory: true)
    return try FileManager.default.contentsOfDirectory(atPath: url.path).filter { $0.hasSuffix(".swift") }.map { "\(directory)/\($0)" }
}

@MainActor @Suite struct AppSettingsTests {
    @Test func defaultsFollowTheDeviceAndSystem() {
        let settings = AppSettings(defaults: isolatedDefaults(), deviceLanguage: .es)
        #expect(settings.theme == .system && settings.theme.colorScheme == nil)
        #expect(settings.savedLanguage == nil && settings.language == .es && settings.l10n.language == .es)
    }

    @Test func choicesPersistUnderOnlyTheTwoKeys() {
        let defaults = isolatedDefaults()
        let before = Set(defaults.dictionaryRepresentation().keys)
        let settings = AppSettings(defaults: defaults, deviceLanguage: .en)
        settings.setTheme(.dark)
        settings.setLanguage(.es)
        let written = Set(defaults.dictionaryRepresentation().keys).subtracting(before)
        #expect(written == [AppSettings.themeKey, AppSettings.languageKey])
        #expect(defaults.string(forKey: "ordo.theme") == "dark" && defaults.string(forKey: "ordo.language") == "es")
        let reopened = AppSettings(defaults: defaults, deviceLanguage: .en)
        #expect(reopened.theme == .dark && reopened.language == .es && reopened.l10n.language == .es)
    }

    @Test func unknownStoredValuesAreIgnored() {
        let defaults = isolatedDefaults()
        defaults.set("sepia", forKey: AppSettings.themeKey)
        defaults.set("fr", forKey: AppSettings.languageKey)
        let settings = AppSettings(defaults: defaults, deviceLanguage: .es)
        #expect(settings.theme == .system && settings.savedLanguage == nil && settings.language == .es)
    }

    @Test func themeMapsToTheColorScheme() {
        #expect(AppTheme.light.colorScheme == .light && AppTheme.dark.colorScheme == .dark)
    }

    @Test func aTypedAmountKeepsItsMeaningAcrossLanguages() {
        for text in ["12.50", "1,234.56"] {
            #expect(AmountInput.parse(text, language: .en, deviceLocale: Locale(identifier: "en_US"))
                == AmountInput.parse(text, language: .es, deviceLocale: Locale(identifier: "en_US")))
        }
    }
}

/// Security and wiring rules read from the source.
@Suite struct AccountSourceRulesTests {
    @Test func theNewFilesNeverLog() throws {
        let files = try swiftFiles("Ordo/Account") + swiftFiles("Ordo/Settings")
            + ["Ordo/Views/CreateAccountView.swift", "Ordo/Views/CheckEmailView.swift", "Ordo/Views/ForgotPasswordView.swift",
               "Ordo/Views/SettingsView.swift", "Ordo/Views/AccountParts.swift", "Ordo/Session/SignInViewModel.swift"]
        #expect(files.count >= 9)
        for file in files {
            let text = try source(file)
            for banned in ["print(", "Logger", "os_log", "NSLog", "debugPrint", "dump("] {
                #expect(!text.contains(banned), "\(banned) in \(file)")
            }
            #expect(!text.contains("Keychain"), "Keychain in \(file)")
        }
        let api = try source("Ordo/Networking/OrdoAPI.swift")
        #expect(!api.contains("print(") && !api.contains("Logger"))
    }

    @Test func onlyAppSettingsWritesDefaultsAmongTheNewFiles() throws {
        for file in try swiftFiles("Ordo/Account") + ["Ordo/Views/SettingsView.swift", "Ordo/Views/CreateAccountView.swift",
                                                       "Ordo/Views/CheckEmailView.swift", "Ordo/Views/ForgotPasswordView.swift"] {
            #expect(!(try source(file)).contains("UserDefaults"), "UserDefaults in \(file)")
        }
        let settings = try source("Ordo/Settings/AppSettings.swift")
        let writes = settings.components(separatedBy: "defaults?.set(").count - 1
        #expect(writes == 2)
        #expect(settings.contains("forKey: Self.themeKey)") && settings.contains("forKey: Self.languageKey)"))
    }

    @Test func themeAndLocaleAreAppliedAtTheRoot() throws {
        let root = try source("Ordo/Views/RootView.swift")
        #expect(root.contains("environment(\\.locale, settings.language.formatLocale)"))
        #expect(root.contains(".preferredColorScheme(settings.theme.colorScheme)"))
        #expect(root.contains(".appearance(model.settings)"))
        #expect(try source("Ordo/OrdoApp.swift").contains(".appearance(settings)"))
    }

    @Test func signOutLivesInSettingsAndUsesAppModelSignOut() throws {
        let settings = try source("Ordo/Views/SettingsView.swift")
        #expect(settings.contains("await model.signOut()"))
        #expect(settings.contains("needsCaptureWarning: model.captureModel.needsSignOutWarning"))
        #expect(!(try source("Ordo/Views/HomeView.swift")).contains(".commonSignOut"))
    }

    @Test func noTokenHandlingOrNewEndpointsBeyondTheThree() throws {
        let api = try source("Ordo/Networking/OrdoAPI.swift")
        #expect(!api.contains("confirm-email") || api.contains("stay on the web"))
        #expect(!api.contains("\"api/auth/confirm-email\"") && !api.contains("\"api/auth/reset-password\""))
    }
}

@MainActor @Suite struct SettingsPresenterTests {
    @Test func theSignOutMessageKeepsTheCaptureWarning() {
        let l10n = L10n(language: .en)
        let base = l10n.string(.authSignOutConfirmMessage)
        #expect(SettingsPresenter.signOutMessage(l10n: l10n, needsCaptureWarning: false) == base)
        #expect(SettingsPresenter.signOutMessage(l10n: l10n, needsCaptureWarning: true)
            == base + "\n\n" + l10n.string(.captureSignOutWarning))
    }
}

/// The real `AppModel` over a stub transport, signed in through the sign-in screen.
@MainActor private struct SettingsRig {
    let transport = StubTransport()
    let model: AppModel
    let settings = AppSettings(defaults: isolatedDefaults(), deviceLanguage: .en)

    init() {
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        model = AppModel(session: SessionManager(api: api, store: InMemoryCredentialStore(initial: nil)), api: api,
                         pendingStore: InMemoryPendingSaveStore(), invalidationMark: isolatedDefaults(),
                         deviceLocale: TimelineFixtures.english, settings: settings)
        transport.route("/api/auth/device-sessions/sign-out") { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
        transport.route(createPath) { _ in
            StubResponse(200, json: #"{"token":"access-1","email":"person@example.test","refreshToken":"refresh-1"}"#)
        }
        transport.route("/api/activity/timeline") { _ in
            StubResponse(200, json: #"{"currencyCode":"USD","items":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#)
        }
    }

    func signIn() async -> Bool {
        await model.start()
        model.signInModel.email = "person@example.test"
        model.signInModel.password = "x"
        await model.signInModel.submit()
        return await waitUntil { await MainActor.run { model.sessionState == .signedIn } }
    }
}

@MainActor @Suite struct AppModelSettingsTests {
    @Test func changingTheLanguageUpdatesTheStringsAndEveryViewModel() async {
        let rig = SettingsRig()
        #expect(rig.model.captureModel.language == .en)
        #expect(rig.model.setLanguage(.es))
        #expect(rig.settings.l10n.language == .es && rig.settings.language == .es)
        #expect(rig.model.captureModel.language == .es && rig.model.mutationModel.language == .es
            && rig.model.budgetsModel.language == .es && rig.model.paychecksModel.language == .es
            && rig.model.recurringModel.language == .es)
    }

    @Test func theLanguageIsLockedWhileAWriteIsInFlight() async throws {
        let rig = SettingsRig()
        #expect(await rig.signIn())
        let gate = Gate()
        rig.transport.route(limitsPath) { request in
            if request.httpMethod == "POST" { await gate.wait(); return StubResponse(200, json: "{}") }
            return StubResponse(200, json: "[]")
        }
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        budgets.beginAdd()
        budgets.edit { $0.choice = .food; $0.amountText = "75" }
        budgets.save()
        #expect(rig.model.isWriteInFlight)
        #expect(!rig.model.canChangeLanguage)
        #expect(!rig.model.setLanguage(.es))
        #expect(rig.settings.language == .en && budgets.language == .en)
        await gate.release()
        await budgets.settled()
        #expect(rig.model.setLanguage(.es))
    }

    @Test func registerAndResendSendTheCurrentLanguage() async {
        let rig = SettingsRig()
        await rig.model.start()
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } })
        rig.transport.route("/api/auth/register") { _ in StubResponse(200) }
        rig.transport.route("/api/auth/resend-confirmation") { _ in StubResponse(202) }
        rig.model.setLanguage(.es)
        let account = rig.model.accountModel
        account.open(.createAccount, email: "new@example.test")
        account.password = "Secret1!"
        account.confirmPassword = "Secret1!"
        await account.register()
        await account.resend()
        let bodies = rig.transport.bodies("/api/auth/register") + rig.transport.bodies("/api/auth/resend-confirmation")
        #expect(bodies.count == 2)
        for body in bodies {
            #expect((try? JSONSerialization.jsonObject(with: body) as? [String: String])?["language"] == "es")
        }
        account.backToSignIn()
        #expect(rig.model.signInModel.email == "new@example.test")
    }

    @Test func signOutKeepsThemeAndLanguageAndResetsTheAccountFlow() async {
        let rig = SettingsRig()
        rig.settings.setTheme(.dark)
        rig.model.setLanguage(.es)
        #expect(await rig.signIn())
        await rig.model.signOut()
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } })
        #expect(rig.settings.theme == .dark && rig.settings.language == .es)
        #expect(rig.model.accountModel.path.isEmpty)
    }
}
