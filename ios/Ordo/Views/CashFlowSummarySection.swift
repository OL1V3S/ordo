import SwiftUI

/// The selected month's deposits, spending, the paycheck breakdown and Deposits minus spending.
struct CashFlowSummarySection: View {
    let report: CashFlowReport
    let presenter: ReportsPresenter
    @State private var aboutExpanded = false

    private var l10n: L10n { presenter.l10n }
    private var money: ReportsFormatter { presenter.formatter }

    var body: some View {
        let bucket = report.selected
        let maximum = bucket.cashIn > bucket.spent ? bucket.cashIn : bucket.spent
        Section {
            VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                Text(verbatim: presenter.monthLabel(report.month)).cashMuted()
                if report.month == BudgetMonth(containing: report.throughDate) {
                    Text(verbatim: l10n.string(.analyticsSummaryThrough, presenter.dateLabel(report.to))).cashMuted()
                }
                Text(verbatim: l10n.string(.analyticsSummaryBasis)).cashMuted()
            }
            VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                CashFigureRow(title: l10n.string(.analyticsSummaryCashIn), value: money.cash(bucket.cashIn), strong: true)
                CashBar(segments: [(ReportsFormatter.barFraction(bucket.paycheckCashIn, of: maximum), CashFlowSeries.paychecks, false),
                                   (ReportsFormatter.barFraction(bucket.otherCashIn, of: maximum), CashFlowSeries.other, true)])
                if bucket.cashIn.isZero { Text(verbatim: l10n.string(.analyticsSummaryNoCashIn)).cashMuted() }
            }
            VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                CashFigureRow(title: l10n.string(.analyticsSummarySpent), value: money.cash(bucket.spent), strong: true)
                CashBar(segments: [(ReportsFormatter.barFraction(bucket.spent, of: maximum), CashFlowSeries.spent, false)])
                if bucket.spent.isZero { Text(verbatim: l10n.string(.analyticsSummaryNoSpending)).cashMuted() }
            }
            VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                CashLegendItem(title: l10n.string(.analyticsSummaryConfirmedPaychecks), color: CashFlowSeries.paychecks)
                CashFigureRow(title: l10n.string(.analyticsSummaryConfirmedPaychecks), value: money.cash(bucket.paycheckCashIn))
                    .accessibilityLabel(Text(verbatim: l10n.string(.analyticsSummaryBreakdownLabel) + ", " + l10n.string(.analyticsSummaryConfirmedPaychecks)))
                CashLegendItem(title: l10n.string(.analyticsSummaryOtherCashIn), color: CashFlowSeries.other, outlined: true)
                CashFigureRow(title: l10n.string(.analyticsSummaryOtherCashIn), value: money.cash(bucket.otherCashIn))
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: l10n.string(.analyticsSummaryBreakdownLabel)))
            VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                Text(verbatim: l10n.string(.analyticsSummaryNetHeading))
                    .font(Theme.Typography.rowTitle.font).foregroundStyle(ThemeColor.text.color)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: money.cash(bucket.net, signed: true)).font(Theme.Typography.title2.font)
                    .foregroundStyle(ThemeColor.text.color)
                Text(verbatim: l10n.string(.analyticsSummaryNetNote)).cashMuted()
            }
            .accessibilityElement(children: .combine)
            DisclosureGroup(isExpanded: $aboutExpanded) {
                about(bucket)
            } label: {
                Text(verbatim: l10n.string(.analyticsSummaryAboutSummary))
                    .font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
            }
            .tint(ThemeColor.text.color)
        } header: {
            Text(verbatim: l10n.string(.analyticsSummaryHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private func about(_ bucket: CashFlowMonth) -> some View {
        let notApplicable = L10nKey.analyticsSummaryFactsNotApplicable
        VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
            ForEach([L10nKey.analyticsSummaryAboutCoverage, .analyticsSummaryAboutComposition,
                     .analyticsSummaryAboutSpending, .analyticsSummaryAboutHistory], id: \.self) { key in
                Text(verbatim: l10n.string(key)).font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
            }
            fact(.analyticsSummaryFactsCashInSpent, presenter.percentage(bucket.spent, of: bucket.cashIn, fallback: notApplicable))
            fact(.analyticsSummaryFactsConfirmedShare, presenter.percentage(bucket.paycheckCashIn, of: bucket.cashIn, fallback: notApplicable))
            fact(.analyticsSummaryFactsOtherShare, presenter.percentage(bucket.otherCashIn, of: bucket.cashIn, fallback: notApplicable))
            fact(.analyticsSummaryFactsInflows, l10n.string(.analyticsSummaryFactsInflowsValue, String(bucket.inflowCount),
                                                          String(bucket.paycheckInflowCount), String(bucket.otherInflowCount)))
            fact(.analyticsSummaryFactsExpenses, String(bucket.expenseCount))
            fact(.analyticsSummaryFactsProfiles, String(bucket.paycheckProfileCount))
            fact(.analyticsSummaryFactsEdited, String(bucket.editedPaycheckInflowCount))
            Text(verbatim: l10n.string(.analyticsSummaryAboutRounding)).cashMuted()
        }
        .padding(.vertical, Theme.Space.s2.points)
    }

    private func fact(_ key: L10nKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: l10n.string(key)).cashMuted()
            Text(verbatim: value).font(Theme.Typography.body.font).foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .combine)
    }
}
