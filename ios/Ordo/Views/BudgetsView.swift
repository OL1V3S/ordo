import SwiftUI

/// The Budgets tab: a month's category limits against the spending recorded for them, with add,
/// edit and delete. Money is shown only as the server last reported it; after a change the limits
/// are read again and Home is refreshed.
struct BudgetsView: View {
    let model: BudgetsViewModel
    let l10n: L10n
    @Environment(\.scenePhase) private var scenePhase

    private var presenter: BudgetsPresenter { BudgetsPresenter(l10n: l10n) }

    var body: some View {
        NavigationStack {
            list
                .themedCanvas()
                .navigationTitle(l10n.string(.budgetsPageTitle))
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { model.beginAdd() } label: {
                            Label(l10n.string(.budgetsToolbarAdd), systemImage: "plus")
                        }
                        .disabled(!model.canAdd)
                    }
                }
                .sheet(isPresented: Binding(get: { model.isSheetPresented },
                                            set: { if !$0 { model.sheetDismissed() } })) {
                    BudgetFormSheet(model: model, presenter: presenter)
                }
                .confirmationDialog(model.deleteTarget.map(presenter.confirmDeleteTitle) ?? "",
                                    isPresented: Binding(get: { model.deleteTarget != nil && !model.isPending },
                                                         set: { if !$0 { model.cancelDelete() } }),
                                    titleVisibility: .visible, presenting: model.deleteTarget) { row in
                    Button(l10n.string(.budgetsCardDelete), role: .destructive) { model.confirmDelete(row) }
                    Button(l10n.string(.commonCancel), role: .cancel) { model.cancelDelete() }
                }
                .task {
                    await model.loadIfNeeded()
                    await model.reloadIfDateChanged()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.reloadIfDateChanged() } }
                }
                .onChange(of: model.feedback) { _, feedback in
                    if let feedback { AccessibilityNotification.Announcement(l10n.string(BudgetsPresenter.feedbackKey(feedback))).post() }
                }
                // A small success tap, only when a change is confirmed.
                .sensoryFeedback(.success, trigger: model.feedback) { _, feedback in
                    switch feedback {
                    case .saved, .deleted: true
                    default: false
                    }
                }
        }
    }

    // MARK: List

    private var list: some View {
        List {
            Section {
                Text(verbatim: l10n.string(.budgetsPageDescription))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                BudgetMonthHeader(model: model, presenter: presenter)
            }
            .themedRows()

            statusSection

            Section {
                rows
            } header: {
                Text(verbatim: l10n.string(.budgetsSectionHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
            }
            .themedRows()

            Section {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                        if let date = presenter.nextResetDate(for: model.month) {
                            Text(verbatim: l10n.string(.budgetsExplanationReset, date))
                        }
                        Text(verbatim: l10n.string(.budgetsExplanationZeroLimit))
                    }
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                } label: {
                    Text(verbatim: l10n.string(.budgetsExplanationSummary))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.text.color)
                }
            }
            .themedRows()
        }
        .themedList()
        .refreshable { await model.refresh() }
    }

    // MARK: Status

    private var statusSection: some View {
        Section {
            if model.task != nil {
                Text(verbatim: presenter.taskNote(month: model.month))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            if model.isPending && model.task == nil { pendingRow }
            if let feedback = model.feedback {
                StatusBanner(tone: BudgetsPresenter.feedbackTone(feedback),
                             systemImage: BudgetsPresenter.feedbackIcon(feedback),
                             message: l10n.string(BudgetsPresenter.feedbackKey(feedback)))
            }
            limitsStatus
            spendingStatus
            actions
        }
        .themedRows()
    }

    private var limitsLoaded: Bool {
        if case .loaded = model.limits { return true }
        return false
    }

    private var pendingRow: some View {
        HStack(spacing: Theme.Space.s3.points) {
            ProgressView().tint(ThemeColor.accent.color)
            Text(verbatim: l10n.string(model.isDeleting ? .cashInDeleteDeleting : .captureSaving))
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    @ViewBuilder private var limitsStatus: some View {
        switch model.limits {
        case .loading:
            progressRow(l10n.string(.budgetsStatesLoadingLimits))
        case .failed, .malformed:
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: presenter.limitsError(month: model.month), tone: .danger)
        case .loaded:
            EmptyView()
        }
    }

    @ViewBuilder private var spendingStatus: some View {
        switch model.spending {
        case .loading:
            progressRow(l10n.string(.budgetsStatesLoadingSpending))
        case .failed:
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(.budgetsStatesSpendingError), tone: .danger)
        case .loaded, .notNeeded:
            EmptyView()
        }
    }

    private func progressRow(_ text: String) -> some View {
        HStack(spacing: Theme.Space.s3.points) {
            ProgressView().tint(ThemeColor.accent.color)
            Text(verbatim: text)
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    @ViewBuilder private var actions: some View {
        Button { Task { await model.refreshLimits() } } label: {
            Text(verbatim: l10n.string(.budgetsSectionRefresh)).frame(maxWidth: .infinity)
        }
        .buttonStyle(OrdoSecondaryButtonStyle())
        .disabled(!model.canRefreshLimits)
        if model.showsSpendingRetry {
            Button { Task { await model.retrySpending() } } label: {
                Text(verbatim: l10n.string(.budgetsStatesRetrySpending)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
            .disabled(!model.canRetrySpending)
        }
    }

    // MARK: Rows

    @ViewBuilder private var rows: some View {
        if limitsLoaded {
            let shown = model.shownRows
            if shown.isEmpty {
                Text(verbatim: l10n.string(.budgetsStatesEmpty))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            ForEach(shown) { row in
                BudgetRow(row: row, card: presenter.card(for: row, evaluation: model.evaluation(for: row)),
                          presenter: presenter, canEdit: model.canEdit(row), canDelete: model.canDelete(row),
                          edit: { model.beginEdit(row) }, delete: { model.beginDelete(row) })
            }
        }
    }
}
