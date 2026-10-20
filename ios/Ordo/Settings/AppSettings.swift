import Foundation
import Observation
import SwiftUI

/// Appearance choice, saved on the device like the web's theme preference.
enum AppTheme: String, CaseIterable, Sendable {
    case system, light, dark

    /// Nil follows the device.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    var labelKey: L10nKey {
        switch self {
        case .system: .commonThemeOptionsSystem
        case .light: .commonThemeOptionsLight
        case .dark: .commonThemeOptionsDark
        }
    }
}

/// The device's theme and language. Only two `UserDefaults` keys are written: `ordo.theme` and
/// `ordo.language`. Nothing else (no email, no password, no token) is stored here. Sign-out and an
/// ended session keep both, like the web.
@MainActor @Observable
final class AppSettings {
    static let themeKey = "ordo.theme"
    static let languageKey = "ordo.language"

    /// Nil keeps the choices in memory only (tests and previews).
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let deviceLanguage: AppLanguage
    private(set) var theme: AppTheme
    /// The saved choice. Nil follows the device language (the behavior before Settings existed).
    private(set) var savedLanguage: AppLanguage?
    private(set) var l10n: L10n

    init(defaults: UserDefaults?, deviceLanguage: AppLanguage = .current) {
        self.defaults = defaults
        self.deviceLanguage = deviceLanguage
        // An unknown stored value is ignored.
        theme = defaults?.string(forKey: Self.themeKey).flatMap(AppTheme.init(rawValue:)) ?? .system
        let saved = defaults?.string(forKey: Self.languageKey).flatMap(AppLanguage.init(rawValue:))
        savedLanguage = saved
        l10n = L10n(language: saved ?? deviceLanguage)
    }

    var language: AppLanguage { savedLanguage ?? deviceLanguage }

    func setTheme(_ theme: AppTheme) {
        self.theme = theme
        defaults?.set(theme.rawValue, forKey: Self.themeKey)
    }

    /// Callers go through `AppModel.setLanguage`, which also updates the view models.
    func setLanguage(_ language: AppLanguage) {
        savedLanguage = language
        defaults?.set(language.rawValue, forKey: Self.languageKey)
        if l10n.language != language { l10n = L10n(language: language) }
    }
}
