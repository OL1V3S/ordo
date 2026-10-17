import Foundation

/// Typed access to `Localizable.xcstrings`. Product copy for Home and sign-in is copied from the
/// web catalogs (`frontend/src/shared/localization/locales`); the keys here are semantic.
struct L10n: Sendable {
    let language: AppLanguage
    private let bundle: Bundle

    init(language: AppLanguage = .current, bundle: Bundle = .main) {
        self.language = language
        if let path = bundle.path(forResource: language.rawValue, ofType: "lproj"),
           let languageBundle = Bundle(path: path) {
            self.bundle = languageBundle
        } else {
            self.bundle = bundle
        }
    }

    /// Looks up a key. Positional `%1$@` arguments are substituted in order.
    func string(_ key: L10nKey, _ arguments: String...) -> String {
        let format = bundle.localizedString(forKey: key.rawValue, value: key.rawValue, table: nil)
        guard !arguments.isEmpty else { return format }
        return String(format: format, locale: language.formatLocale, arguments: arguments)
    }

    /// True when the key has a real translation in this language (not just the key echoed back).
    func hasTranslation(_ key: L10nKey) -> Bool {
        bundle.localizedString(forKey: key.rawValue, value: "\u{0}missing", table: nil) != "\u{0}missing"
    }
}
