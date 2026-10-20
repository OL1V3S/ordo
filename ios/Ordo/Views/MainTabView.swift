import SwiftUI

/// The signed-in app: Home, Transactions, Budgets, Paychecks and Recurring, each with its own navigation stack. The system tab bar
/// is Liquid Glass on iOS 26 and later and the standard bar before that. Capture (Add expense and
/// Add deposit) is presented only from Home, so two views never present the same sheet. Reports
/// opens from a Home toolbar button, so the five tabs stay (a sixth would hide two behind "More").
struct MainTabView: View {
    let model: AppModel
    let l10n: L10n

    var body: some View {
        TabView {
            Tab(l10n.string(.navigationDestinationsHome), systemImage: "house") {
                HomeView(model: model.homeModel, capture: model.captureModel, reports: model.reportsModel, writeBlocked: model.isWriteInFlight,
                         l10n: l10n) { Task { await model.signOut() } }
            }
            Tab(l10n.string(.navigationDestinationsActivity), systemImage: "list.bullet.rectangle") {
                TransactionsView(model: model.transactionsModel, mutation: model.mutationModel, importModel: model.importModel, l10n: l10n)
            }
            // The web's Plan hub holds Budgets, Recurring expenses and Paychecks; on the phone each is
            // a tab of its own (five tabs, no "More"). The tab label is shorter than the page title.
            Tab(l10n.string(.navigationDestinationsBudgets), systemImage: "chart.pie") {
                BudgetsView(model: model.budgetsModel, l10n: l10n)
            }
            Tab(l10n.string(.navigationDestinationsPaychecks), systemImage: "banknote") {
                PaychecksView(model: model.paychecksModel, l10n: l10n)
            }
            Tab(l10n.string(.commitmentsIosTabLabel), systemImage: "repeat") {
                RecurringView(model: model.recurringModel, l10n: l10n)
            }
        }
    }
}
