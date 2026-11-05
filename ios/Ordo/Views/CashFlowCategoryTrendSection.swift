import Charts
import SwiftUI

/// Top categories by month: a stacked Swift Charts bar chart (hidden from VoiceOver) with the exact
/// "View chart data" list as the accessible alternative.
struct CashFlowCategoryTrendSection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter
    @State private var dataExpanded = false
    @ScaledMetric(relativeTo: .body) private var chartHeight = 220.0

    private var l10n: L10n { presenter.l10n }
    private var throughMonth: BudgetMonth { BudgetMonth(containing: report.throughDate) }

    private func name(_ series: ReportsPresenter.CategorySeries) -> String {
        series.category.map { CategoryLabel.label(for: $0, l10n: l10n) } ?? l10n.string(.analyticsCategoriesDonutOther, String(series.count))
    }

    var body: some View {
        let series = ReportsPresenter.categoryTrend(report.months)
        let names = series.map(name)
        Section {
            if series.isEmpty {
                Text(verbatim: l10n.string(.analyticsCategoryTrendEmpty)).cashMuted()
            } else {
                chart(series, names: names)
                DisclosureGroup(isExpanded: $dataExpanded) {
                    dataList(series, names: names)
                } label: {
                    Text(verbatim: l10n.string(.analyticsChartTableSummary))
                        .font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
                }
                .tint(ThemeColor.text.color)
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: l10n.string(.analyticsCategoryTrendKicker)).cashMuted()
                Text(verbatim: l10n.string(.analyticsCategoryTrendHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
            }
        }
        .themedRows()
    }

    private func chart(_ series: [ReportsPresenter.CategorySeries], names: [String]) -> some View {
        let months = report.months
        return Chart {
            ForEach(Array(series.enumerated()), id: \.offset) { index, entry in
                ForEach(Array(months.enumerated()), id: \.offset) { monthIndex, bucket in
                    BarMark(x: .value("Month", bucket.month.key),
                            y: .value("USD", entry.amounts[monthIndex].approximateDollars))
                        .foregroundStyle(by: .value("Series", names[index]))
                }
            }
        }
        .chartForegroundStyleScale(domain: names)
        .chartLegend(position: .bottom)
        .chartYAxisLabel("USD")
        .chartXAxis {
            AxisMarks(values: months.map(\.month.key)) { value in
                AxisValueLabel {
                    if let key = value.as(String.self), let month = months.first(where: { $0.month.key == key })?.month {
                        let parts = presenter.tickParts(month)
                        VStack(spacing: 0) {
                            Text(verbatim: parts.month)
                            Text(verbatim: parts.year)
                            if month == throughMonth { Text(verbatim: l10n.string(.analyticsChartMonthToDateTick)) }
                        }
                        .font(Theme.Typography.caption.font)
                    }
                }
            }
        }
        .frame(height: chartHeight)
        .transaction { $0.animation = nil }
        .accessibilityHidden(true)
    }

    private func dataList(_ series: [ReportsPresenter.CategorySeries], names: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4.points) {
            Text(verbatim: l10n.string(.analyticsCategoryTrendTableCaption)).cashMuted()
            ForEach(Array(report.months.enumerated()), id: \.offset) { monthIndex, bucket in
                VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                    Text(verbatim: presenter.monthLabel(bucket.month))
                        .font(Theme.Typography.rowTitle.font).foregroundStyle(ThemeColor.text.color)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(series.enumerated()), id: \.offset) { index, entry in
                        CashFigureRow(title: names[index], value: presenter.formatter.cash(entry.amounts[monthIndex]))
                    }
                    CashFigureRow(title: l10n.string(.analyticsCategoryTrendTableSpent), value: presenter.formatter.cash(bucket.spent), strong: true)
                }
                .accessibilityElement(children: .contain)
            }
        }
        .padding(.vertical, Theme.Space.s2.points)
    }
}
