import SwiftUI

struct RootView: View {
    let model: AppModel

    var body: some View {
        let l10n = model.settings.l10n
        Group {
            switch model.sessionState {
            case .restoring:
                ProgressView(l10n.string(.appRestoring))
                    .tint(ThemeColor.accent.color)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .themedCanvas()
                    .accessibilityAddTraits(.updatesFrequently)
            case .signedOut(let reason):
                SignInView(model: model.signInModel, account: model.accountModel, notice: reason,
                           language: LanguageChoice(model: model), l10n: l10n)
            case .signedIn:
                MainTabView(model: model, l10n: l10n)
            }
        }
        .appearance(model.settings)
    }
}

extension View {
    /// The in-app theme and language at the window root: sheets, dialogs, date pickers and search
    /// fields follow them. System leaves the color scheme to the device.
    func appearance(_ settings: AppSettings) -> some View {
        environment(\.locale, settings.language.formatLocale)
            .preferredColorScheme(settings.theme.colorScheme)
    }
}

struct NotConfiguredView: View {
    let l10n: L10n

    var body: some View {
        StatusMessageView(systemImage: "gearshape.2", message: l10n.string(.appNotConfiguredTitle) + "\n" + l10n.string(.appNotConfiguredMessage))
            .frame(maxHeight: .infinity)
            .themedCanvas()
    }
}
