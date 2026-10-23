import Foundation

/// The two supported languages. Formatting follows the chosen language: `en` uses `en_US`
/// and `es` uses `es_MX` (matching `FORMAT_TAGS` in the web app).
enum AppLanguage: String, CaseIterable, Sendable {
    case en
    case es

    var formatLocale: Locale { Locale(identifier: self == .en ? "en_US" : "es_MX") }

    /// Standard iOS resolution: the first of the user's preferred languages that the app offers.
    static func resolve(preferredLanguages: [String] = Locale.preferredLanguages) -> AppLanguage {
        let match = Bundle.preferredLocalizations(from: AppLanguage.allCases.map(\.rawValue),
                                                  forPreferences: preferredLanguages).first
        return match.flatMap(AppLanguage.init(rawValue:)) ?? .en
    }

    static var current: AppLanguage { resolve() }
}
