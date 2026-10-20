import Charts
import SwiftUI

/// The six-month trend: a Swift Charts bar chart for the overview (hidden from VoiceOver) and the
/// exact "View chart data" list as the accessible alternative.
struct CashFlowTrendSection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter
    @State private var dataExpanded = false
    @ScaledMetric(relativeTo: .body) private var chartHeight = 220.0

    private var l10n: L10n { presenter.l10n }
    private var throughMonth: BudgetMonth { BudgetMonth(containing: report.throughDate) }

    private struct Point: Identifiable {
        let id: String
        let tickMonth: String
        let tickYear: String
        let paychecks: Double
        let other: Double
        let spent: Double
        let monthToDate: Bool
    }

    private var points: [Point] {
        report.months.map { bucket in
            let parts = presenter.tickParts(bucket.month)
            return Point(id: bucket.month.key, tickMonth: parts.month, tickYear: parts.year,
                         paychecks: bucket.paycheckCashIn.approximateDollars, other: bucket.otherCashIn.approximateDollars,
                         spent: bucket.spent.approximateDollars, monthToDate: bucket.month == throughMonth)
        }
    }

    var body: some View {
        let paychecksName = l10n.string(.analyticsChartDatasetsPaychecks)
        let otherName = l10n.string(.analyticsChartDatasetsOther)
        let spentName = l10n.string(.analyticsChartDatasetsSpent)
        let points = self.points
        Section {
            Chart {
                ForEach(points) { point in
                    BarMark(x: .value("Month", point.id), y: .value("USD", point.paychecks))
                        .foregroundStyle(by: .value("Series", paychecksName))
                        .position(by: .value("Group", "in"))
                    BarMark(x: .value("Month", point.id), y: .value("USD", point.other))
                        .foregroundStyle(by: .value("Series", otherName))
                        .position(by: .value("Group", "in"))
                    BarMark(x: .value("Month", point.id), y: .value("USD", point.spent))
                        .foregroundStyle(by: .value("Series", spentName))
                        .position(by: .value("Group", "out"))
                }
            }
            .chartForegroundStyleScale([paychecksName: CashFlowSeries.paychecks.color, otherName: CashFlowSeries.other.color,
                                        spentName: CashFlowSeries.spent.color])
            .chartLegend(.hidden)
            .chartYAxisLabel("USD")
            .chartXAxis {
                AxisMarks(values: points.map(\.id)) { value in
                    AxisValueLabel {
                        if let id = value.as(String.self), let point = points.first(where: { $0.id == id }) {
                            VStack(spacing: 0) {
                                Text(verbatim: point.tickMonth)
                                Text(verbatim: point.tickYear)
                                if point.monthToDate { Text(verbatim: l10n.string(.analyticsChartMonthToDateTick)) }
                            }
                            .font(Theme.Typography.caption.font)
                        }
                    }
                }
            }
            .frame(height: chartHeight)
            .transaction { $0.animation = nil }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                Text(verbatim: l10n.string(.analyticsChartLegendLabel)).cashMuted()
                CashLegendItem(title: paychecksName, color: CashFlowSeries.paychecks)
                CashLegendItem(title: otherName, color: CashFlowSeries.other, outlined: true)
                CashLegendItem(title: spentName, color: CashFlowSeries.spent)
            }
            .accessibilityElement(children: .contain)
            if report.months.contains(where: { $0.month == throughMonth }) {
                Text(verbatim: l10n.string(.analyticsChartMonthToDateNote)).cashMuted()
            }
            DisclosureGroup(isExpanded: $dataExpanded) {
                dataList
            } label: {
                Text(verbatim: l10n.string(.analyticsChartTableSummary))
                    .font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
            }
            .tint(ThemeColor.text.color)
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: presenter.trendKicker(monthCount: report.months.count)).cashMuted()
                Text(verbatim: l10n.string(.analyticsChartHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
            }
        }
        .themedRows()
    }

    private var dataList: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4.points) {
            Text(verbatim: l10n.string(.analyticsChartTableCaption)).cashMuted()
            ForEach(Array(report.months.enumerated()), id: \.offset) { _, bucket in
                VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                    Text(verbatim: presenter.monthLabel(bucket.month))
                        .font(Theme.Typography.rowTitle.font).foregroundStyle(ThemeColor.text.color)
                        .accessibilityAddTraits(.isHeader)
                    CashFigureRow(title: l10n.string(.analyticsChartTableCashIn), value: presenter.formatter.cash(bucket.cashIn))
                    CashFigureRow(title: l10n.string(.analyticsChartTablePaychecks), value: presenter.formatter.cash(bucket.paycheckCashIn))
                    CashFigureRow(title: l10n.string(.analyticsChartTableOther), value: presenter.formatter.cash(bucket.otherCashIn))
                    CashFigureRow(title: l10n.string(.analyticsChartTableSpent), value: presenter.formatter.cash(bucket.spent))
                    CashFigureRow(title: l10n.string(.analyticsChartTableNet), value: presenter.formatter.cash(bucket.net, signed: true))
                    CashFigureRow(title: l10n.string(.analyticsChartTableNote),
                                  value: presenter.periodNotes(bucket, throughDate: report.throughDate))
                }
                .accessibilityElement(children: .contain)
            }
        }
        .padding(.vertical, Theme.Space.s2.points)
    }
}
