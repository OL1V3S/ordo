import SwiftUI

/// The selected month's spending by category, ranked by amount, each with its share of Spent.
struct CashFlowCategoriesSection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        let categories = ReportsPresenter.ordered(report.categories)
        let spent = report.selected.spent
        Section {
            if categories.isEmpty {
                InlineStatusView(systemImage: "tray", message: l10n.string(.analyticsCategoriesEmpty))
            } else {
                ForEach(Array(categories.enumerated()), id: \.offset) { _, category in
                    VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                        CashFigureRow(title: CategoryLabel.label(for: category.category, l10n: l10n),
                                      value: presenter.formatter.cash(category.amount) + " · "
                                          + presenter.percentage(category.amount, of: spent, fallback: .analyticsCategoriesNotApplicable))
                        CashBar(segments: [(ReportsFormatter.barFraction(category.amount, of: spent), CashFlowSeries.spent, false)])
                    }
                }
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: l10n.string(.analyticsCategoriesKicker)).cashMuted()
                Text(verbatim: l10n.string(.analyticsCategoriesHeading)).themedSectionHeader()
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .themedRows()
    }
}
