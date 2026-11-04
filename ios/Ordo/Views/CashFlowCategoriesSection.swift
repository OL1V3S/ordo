import Charts
import SwiftUI

/// The selected month's spending by category, ranked by amount, each with its share of Spent.
struct CashFlowCategoriesSection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter

    private var l10n: L10n { presenter.l10n }

    private func name(_ share: ReportsPresenter.CategoryShare) -> String {
        share.category.map { CategoryLabel.label(for: $0, l10n: l10n) }
            ?? l10n.string(.analyticsCategoriesDonutOther, String(share.count))
    }

    /// Decorative overview of the list below, which carries every exact amount.
    @ViewBuilder private func donut(_ shares: [ReportsPresenter.CategoryShare]) -> some View {
        if !shares.isEmpty {
            let names = shares.map(name)
            Chart(Array(shares.enumerated()), id: \.offset) { index, share in
                SectorMark(angle: .value("Amount", share.amount.approximateDollars), innerRadius: .ratio(0.6), angularInset: 1)
                    .foregroundStyle(by: .value("Category", names[index]))
            }
            .chartLegend(position: .bottom)
            .frame(height: 220)
            .transaction { $0.animation = nil }
            .accessibilityHidden(true)
        }
    }

    var body: some View {
        let categories = ReportsPresenter.ordered(report.categories)
        let spent = report.selected.spent
        Section {
            if categories.isEmpty {
                InlineStatusView(systemImage: "tray", message: l10n.string(.analyticsCategoriesEmpty))
            } else {
                donut(ReportsPresenter.categoryShares(report.categories, spent: spent))
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
