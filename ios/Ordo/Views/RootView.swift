import SwiftUI

struct RootView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        switch model.sessionState {
        case .restoring:
            ProgressView(l10n.string(.appRestoring)).frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityAddTraits(.updatesFrequently)
        case .signedOut(let reason):
            SignInView(model: model.signInModel, notice: reason, l10n: l10n)
        case .signedIn:
            HomeView(model: model.homeModel, l10n: l10n) { Task { await model.signOut() } }
        }
    }
}

struct NotConfiguredView: View {
    let l10n: L10n

    var body: some View {
        StatusMessageView(systemImage: "gearshape.2", message: l10n.string(.appNotConfiguredTitle) + "\n" + l10n.string(.appNotConfiguredMessage))
    }
}
