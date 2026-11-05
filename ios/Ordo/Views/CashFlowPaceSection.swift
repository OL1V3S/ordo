import Charts
import SwiftUI

/// Daily spending pace: the selected month's running total against the previous month's, as a
/// Swift Charts overview (hidden from VoiceOver) with the exact days as the accessible alternative.
struct CashFlowPaceSection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter
    @State private var dataExpanded = false
    @ScaledMetric(relativeTo: .body) private var chartHeight = 200.0

    private var l10n: L10n { presenter.l10n }

    private struct Line: Identifiable {
        let id: String
        let label: String
        let points: [ReportsPresenter.DayPoint]
        let isCurrent: Bool
    }

    private var lines: [Line] {
        var result = [Line(id: report.selected.month.key, label: presenter.monthLabel(report.selected.month),
                           points: ReportsPresenter.cumulativeDays(report.selected), isCurrent: true)]
        if let previous = ReportsPresenter.previousMonth(report.months) {
            result.append(Line(id: previous.month.key, label: presenter.monthLabel(previous.month),
                               points: ReportsPresenter.cumulativeDays(previous), isCurrent: false))
        }
        return result
    }

    var body: some View {
        let lines = self.lines
        let hasSpending = lines.contains { $0.points.last.map { !$0.cumulative.isZero } ?? false }
        Section {
            if lines[0].points.isEmpty || !hasSpending {
                Text(verbatim: l10n.string(.analyticsPaceEmpty)).cashMuted()
            } else {
                chart(lines)
                VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                    Text(verbatim: l10n.string(.analyticsChartLegendLabel)).cashMuted()
                    ForEach(lines) { line in
                        CashLegendItem(title: line.label, color: line.isCurrent ? CashFlowSeries.spent : .borderStrong)
                    }
                }
                .accessibilityElement(children: .contain)
                DisclosureGroup(isExpanded: $dataExpanded) {
                    dataList
                } label: {
                    Text(verbatim: l10n.string(.analyticsPaceTableSummary))
                        .font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
                }
                .tint(ThemeColor.text.color)
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: l10n.string(.analyticsPaceKicker)).cashMuted()
                Text(verbatim: l10n.string(.analyticsPaceHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
            }
        }
        .themedRows()
    }

    private func chart(_ lines: [Line]) -> some View {
        Chart {
            ForEach(lines) { line in
                ForEach(line.points, id: \.date) { point in
                    LineMark(x: .value("Day", point.day), y: .value("USD", point.cumulative.approximateDollars),
                             series: .value("Month", line.id))
                        .foregroundStyle(line.isCurrent ? CashFlowSeries.spent.color : ThemeColor.borderStrong.color)
                        .lineStyle(StrokeStyle(lineWidth: 2, dash: line.isCurrent ? [] : [6, 4]))
                }
            }
            RuleMark(y: .value("Zero", 0))
                .foregroundStyle(ThemeColor.borderStrong.color)
                .lineStyle(StrokeStyle(lineWidth: 1))
        }
        .chartLegend(.hidden)
        .chartYAxisLabel("USD")
        .frame(height: chartHeight)
        .transaction { $0.animation = nil }
        .accessibilityHidden(true)
    }

    private var dataList: some View {
        let points = ReportsPresenter.cumulativeDays(report.selected)
        return VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            Text(verbatim: l10n.string(.analyticsPaceTableCaption)).cashMuted()
            ForEach(points.filter { !$0.spent.isZero }, id: \.date) { point in
                VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                    Text(verbatim: presenter.dateLabel(point.date))
                        .font(Theme.Typography.rowTitle.font).foregroundStyle(ThemeColor.text.color)
                        .accessibilityAddTraits(.isHeader)
                    CashFigureRow(title: l10n.string(.analyticsPaceTableDay), value: presenter.formatter.cash(point.spent))
                    CashFigureRow(title: l10n.string(.analyticsPaceTableTotal), value: presenter.formatter.cash(point.cumulative))
                }
                .accessibilityElement(children: .contain)
            }
            CashFigureRow(title: l10n.string(.analyticsChartTableSpent), value: presenter.formatter.cash(report.selected.spent), strong: true)
        }
        .padding(.vertical, Theme.Space.s2.points)
    }
}
