import SwiftUI

/// Reports: the web's cash-flow region (summary, categories, trend) for one month. Read-only.
/// Pushed from Home, so it has no navigation stack of its own.
struct ReportsView: View {
    let model: ReportsViewModel
    let l10n: L10n

    var body: some View {
        let presenter = ReportsPresenter(l10n: l10n)
        List {
            Section {
                ReportsMonthHeader(model: model, presenter: presenter)
            } header: {
                Text(verbatim: l10n.string(.analyticsPageDescription))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                    .textCase(nil)
            }
            .themedRows()
            switch model.phase {
            case .idle, .loading:
                Section {
                    HStack(spacing: Theme.Space.s3.points) {
                        ProgressView().tint(ThemeColor.accent.color)
                        Text(verbatim: l10n.string(.analyticsCashFlowLoading))
                            .font(Theme.Typography.body.font)
                            .foregroundStyle(ThemeColor.text.color)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.updatesFrequently)
                }
                .themedRows()
            case .failed:
                Section {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.analyticsCashFlowErrorsLoadFailed), tone: .danger)
                    Button(l10n.string(.analyticsCashFlowRetry)) { Task { await model.refresh() } }
                        .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
                }
                .themedRows()
                .onAppear { AccessibilityNotification.Announcement(l10n.string(.analyticsCashFlowErrorsLoadFailed)).post() }
            case .loaded(let report):
                CashFlowSummarySection(report: report, presenter: presenter)
                CashFlowCategoriesSection(report: report, presenter: presenter)
                CashFlowTrendSection(report: report, presenter: presenter)
            }
        }
        .themedList()
        .navigationTitle(l10n.string(.analyticsPageTitle))
        .task { await model.loadIfNeeded() }
        .refreshable { await model.refresh() }
    }
}
