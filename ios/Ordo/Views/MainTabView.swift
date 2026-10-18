import SwiftUI

/// The signed-in app: Home and Transactions, each with its own navigation stack. The system tab bar
/// is Liquid Glass on iOS 26 and later and the standard bar before that. Capture (Add expense and
/// Add deposit) is presented only from Home, so two views never present the same sheet.
struct MainTabView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        TabView {
            Tab(l10n.string(.navigationDestinationsHome), systemImage: "house") {
                HomeView(model: model.homeModel, capture: model.captureModel, writeBlocked: model.isWriteInFlight,
                         l10n: l10n) { Task { await model.signOut() } }
            }
            Tab(l10n.string(.navigationDestinationsActivity), systemImage: "list.bullet.rectangle") {
                TransactionsView(model: model.transactionsModel, mutation: model.mutationModel, l10n: l10n)
            }
        }
    }
}
