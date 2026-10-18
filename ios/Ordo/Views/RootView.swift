import SwiftUI

struct RootView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        switch model.sessionState {
        case .restoring:
            ProgressView(l10n.string(.appRestoring))
                .tint(ThemeColor.accent.color)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .themedCanvas()
                .accessibilityAddTraits(.updatesFrequently)
        case .signedOut(let reason):
            SignInView(model: model.signInModel, notice: reason, l10n: l10n)
        case .signedIn:
            MainTabView(model: model, l10n: l10n)
        }
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
