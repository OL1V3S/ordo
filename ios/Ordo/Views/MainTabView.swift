import SwiftUI

/// The signed-in app: Home, Transactions, Plan, Reports and Settings, each with its own navigation
/// stack. Plan holds Budgets, Recurring expenses and Paychecks behind a switcher, as the web's Plan
/// hub does. The system tab bar is Liquid Glass on iOS 26 and later and the standard bar before
/// that. Capture (Add expense and Add deposit) is presented only from Home, so two views never
/// present the same sheet.
struct MainTabView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        TabView {
            Tab(l10n.string(.navigationDestinationsHome), systemImage: "house") {
                HomeView(model: model.homeModel, capture: model.captureModel, writeBlocked: model.isWriteInFlight, l10n: l10n)
            }
            Tab(l10n.string(.navigationDestinationsActivity), systemImage: "list.bullet.rectangle") {
                TransactionsView(model: model.transactionsModel, mutation: model.mutationModel, importModel: model.importModel, l10n: l10n)
            }
            Tab(l10n.string(.navigationDestinationsPlan), systemImage: "list.clipboard") {
                PlanView(model: model, l10n: l10n)
            }
            Tab(l10n.string(.navigationDestinationsInsights), systemImage: "chart.bar.xaxis") {
                ReportsView(model: model.reportsModel, l10n: l10n)
            }
            Tab(l10n.string(.settingsTitle), systemImage: "gearshape") {
                SettingsView(model: model, l10n: l10n)
            }
        }
    }
}
