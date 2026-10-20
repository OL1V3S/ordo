import Foundation
import Testing
@testable import Ordo

@Suite struct LocalizationTests {
    @Test(arguments: AppLanguage.allCases)
    func everyKeyResolvesInEveryLanguage(language: AppLanguage) {
        let l10n = L10n(language: language)
        for key in L10nKey.allCases {
            #expect(l10n.hasTranslation(key), "missing \(key.rawValue) in \(language.rawValue)")
            #expect(!l10n.string(key).isEmpty)
        }
    }

    @Test func spanishDiffersFromEnglishForProductCopy() {
        #expect(L10n(language: .es).string(.homeAttentionHeading) == "Requiere tu atención")
        #expect(L10n(language: .en).string(.homeAttentionHeading) == "Needs your attention")
    }

    @Test func spanishWordingGuard() {
        let es = L10n(language: .es)
        for key in L10nKey.allCases {
            let text = es.string(key)
            #expect(!text.lowercased().contains("usted"), "usted in \(key.rawValue)")
            #expect(!text.contains("..."), "three dots in \(key.rawValue)")
            // "pago" is only acceptable as part of "pago de nómina".
            var stripped = text.lowercased().replacingOccurrences(of: "pagos de nómina", with: "")
                .replacingOccurrences(of: "pago de nómina", with: "")
            // Documented exception (docs/localization.md): "pagos de deudas" in this key only.
            if key.rawValue == "analytics.summary.about.spending" {
                stripped = stripped.replacingOccurrences(of: "pagos de deudas", with: "")
            }
            #expect(!stripped.contains("pago"), "bare pago in \(key.rawValue)")
        }
    }

    @Test func positionalArgumentsAreSubstituted() {
        let text = L10n(language: .en).string(.homeAttentionBudgetStatesOverLimit, "$5.00", "$4.00")
        #expect(text == "Over limit: $5.00 spent of $4.00.")
    }

    @Test func languageResolutionFollowsPreferenceOrder() {
        #expect(AppLanguage.resolve(preferredLanguages: ["es-MX", "en-US"]) == .es)
        #expect(AppLanguage.resolve(preferredLanguages: ["es-419", "en"]) == .es)
        #expect(AppLanguage.resolve(preferredLanguages: ["en-GB", "es"]) == .en)
        #expect(AppLanguage.resolve(preferredLanguages: ["fr-FR"]) == .en)
    }
}

@Suite struct AppConfigurationTests {
    @Test func httpsAlwaysAllowed() {
        #expect(AppConfiguration.make(from: "https://api.example.test/", allowLocalHTTP: false)?.baseURL.absoluteString == "https://api.example.test")
    }

    @Test func httpOnlyForLocalhostInDebug() {
        #expect(AppConfiguration.make(from: "http://localhost:5298", allowLocalHTTP: true) != nil)
        #expect(AppConfiguration.make(from: "http://127.0.0.1:5298", allowLocalHTTP: true) != nil)
        #expect(AppConfiguration.make(from: "http://localhost:5298", allowLocalHTTP: false) == nil)
        #expect(AppConfiguration.make(from: "http://api.example.test", allowLocalHTTP: true) == nil)
    }

    @Test func missingOrInvalidIsNil() {
        for text: String? in [nil, "", "   ", "not a url", "ftp://host", "https://", "https://u:p@host"] {
            #expect(AppConfiguration.make(from: text, allowLocalHTTP: true) == nil)
        }
    }
}
