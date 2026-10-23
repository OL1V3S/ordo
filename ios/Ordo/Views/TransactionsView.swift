import SwiftUI

/// The Transactions tab: the signed-in user's timeline with server paging, search and filters, and
/// Edit and Delete on every row. Money is shown only as the server last reported it; after a change
/// the list is re-read.
struct TransactionsView: View {
    let model: TransactionsViewModel
    let mutation: TransactionMutationViewModel
    let importModel: ImportViewModel
    let l10n: L10n

    private var presenter: TransactionsPresenter { TransactionsPresenter(l10n: l10n) }

    var body: some View {
        NavigationStack {
            content
                .themedCanvas()
                .navigationTitle(l10n.string(.activityPageTitle))
                .searchable(text: searchBinding, prompt: Text(verbatim: l10n.string(.timelineFiltersSearchPlaceholder)))
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { importModel.isPresented = true } label: {
                            Label(l10n.string(.activityPageImportStatement), systemImage: "doc.badge.plus")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { model.isFiltersPresented = true } label: {
                            Label(l10n.string(.timelineFiltersToggle),
                                  systemImage: model.isFilterActive ? "line.3.horizontal.decrease.circle.fill"
                                                                    : "line.3.horizontal.decrease.circle")
                        }
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { statusInset }
                .fullScreenCover(isPresented: Bindable(importModel).isPresented) { ImportStatementView(model: importModel, l10n: l10n) }
                .sheet(isPresented: Bindable(model).isFiltersPresented) { TransactionFiltersSheet(model: model, l10n: l10n) }
                .sheet(isPresented: Binding(get: { mutation.isSheetPresented },
                                            set: { if !$0 { mutation.sheetDismissed() } })) {
                    EditTransactionSheet(model: mutation, l10n: l10n)
                }
                .confirmationDialog(mutation.target.map(presenter.deleteHeading) ?? "",
                                    isPresented: Binding(get: { mutation.phase == .confirmingDelete },
                                                         set: { if !$0 { mutation.cancelDelete() } }),
                                    titleVisibility: .visible, presenting: mutation.target) { item in
                    Button(presenter.deleteConfirm(item.captureKind), role: .destructive) { mutation.confirmDelete(item) }
                    Button(l10n.string(.commonCancel), role: .cancel) { mutation.cancelDelete() }
                } message: { item in
                    if let message = presenter.deleteMessage(item) { Text(verbatim: message) }
                }
                .task { await model.loadIfNeeded() }
                .onChange(of: mutation.notice) { _, notice in
                    if let notice {
                        AccessibilityNotification.Announcement(l10n.string(TransactionsPresenter.noticeKey(notice))).post()
                    }
                }
                .onChange(of: endReached) { _, reached in
                    if reached { AccessibilityNotification.Announcement(l10n.string(.timelineEnd)).post() }
                }
                // A small success tap, only when a change is confirmed.
                .sensoryFeedback(.success, trigger: mutation.notice) { _, notice in
                    switch notice {
                    case .updated, .deleted: true
                    default: false
                    }
                }
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView(l10n.string(.timelineLoading))
                .tint(ThemeColor.accent.color)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityAddTraits(.updatesFrequently)
        case .failed(let failure):
            let message = l10n.string(TransactionsPresenter.failureKey(failure))
            failureView(icon: failure == .offline ? "wifi.slash" : "exclamationmark.triangle", message: message,
                        tone: failure == .offline ? .neutral : .danger,
                        retryTitle: failure == .filterRejected ? l10n.string(.timelineFiltersClear) : l10n.string(.timelineRetry)) {
                if failure == .filterRejected { model.clearFilters() } else { Task { await model.load() } }
            }
        case .malformed:
            failureView(icon: "exclamationmark.triangle", message: l10n.string(.timelineMalformed), tone: .danger,
                        retryTitle: l10n.string(.timelineRetry)) { Task { await model.load() } }
        case .loaded(let loaded):
            list(loaded)
        }
    }

    private func failureView(icon: String, message: String, tone: StatusTone, retryTitle: String,
                             retry: @escaping () -> Void) -> some View {
        ScrollView {
            StatusMessageView(systemImage: icon, message: message, tone: tone, retryTitle: retryTitle, retry: retry)
                .padding(.top, Theme.Space.s7.points)
        }
        .refreshable { await model.refresh() }
        .onAppear { AccessibilityNotification.Announcement(message).post() }
    }

    private func list(_ loaded: TransactionsViewModel.Loaded) -> some View {
        List {
            Section {
                if TimelineFilterRules.isActive(loaded.filter) { filterSummary(loaded.filter) }
                if model.filterProblem != nil {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.timelineFiltersInvalid), tone: .danger)
                }
                if model.isRefreshing {
                    HStack(spacing: Theme.Space.s3.points) {
                        ProgressView().tint(ThemeColor.accent.color)
                        Text(verbatim: l10n.string(.timelineRefreshing))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.textMuted.color)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.updatesFrequently)
                }
                if model.refreshFailed {
                    InlineStatusView(systemImage: "exclamationmark.triangle",
                                     message: l10n.string(.timelineRefreshFailed), tone: .warning)
                    Button { Task { await model.refresh() } } label: {
                        Text(verbatim: l10n.string(.timelineRetry)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .themedButtonRow()
                }
                if loaded.items.isEmpty && !model.refreshFailed {
                    InlineStatusView(systemImage: "tray",
                                     message: l10n.string(TimelineFilterRules.isActive(loaded.filter) ? .timelineFiltersNoMatches : .timelineEmpty))
                }
                ForEach(loaded.items) { item in
                    // No row actions while the list re-reads: the rows shown may be stale.
                    TransactionRow(item: item, presenter: presenter,
                                   actionsEnabled: mutation.canStart && !model.isRefreshing,
                                   edit: { mutation.beginEdit(item) }, delete: { mutation.beginDelete(item) })
                }
                paging(loaded)
            } header: {
                VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                    Text(verbatim: l10n.string(.timelineHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
                    Text(verbatim: l10n.string(.timelineIntro))
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                        .textCase(nil)
                }
            }
            .themedRows()
        }
        .themedList()
        .accessibilityLabel(Text(verbatim: l10n.string(.timelineListLabel)))
        .refreshable { await model.refresh() }
    }

    private func filterSummary(_ filter: TimelineFilter) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            Text(verbatim: presenter.filterSummary(filter))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.text.color)
            Button { model.clearFilters() } label: {
                Text(verbatim: l10n.string(.timelineFiltersClear)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
        }
    }

    @ViewBuilder private func paging(_ loaded: TransactionsViewModel.Loaded) -> some View {
        if model.loadMoreFailed {
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(.timelineLoadMoreFailed), tone: .warning)
            Button { Task { await model.loadMore() } } label: {
                Text(verbatim: l10n.string(.timelineRetryMore)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
            .themedButtonRow()
        } else if model.isLoadingMore {
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(.timelineLoadingMore))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        } else if loaded.hasMore {
            Button { Task { await model.loadMore() } } label: {
                Text(verbatim: l10n.string(.timelineShowOlder)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
            .themedButtonRow()
        } else if !loaded.items.isEmpty {
            InlineStatusView(systemImage: "checkmark.circle", message: l10n.string(.timelineEnd))
        }
    }

    // MARK: Status

    private var endReached: Bool {
        if case .loaded(let loaded) = model.phase { return !loaded.hasMore && !loaded.items.isEmpty }
        return false
    }

    private var showsPendingBanner: Bool {
        (mutation.phase == .submitting || mutation.phase == .uncertain) && !mutation.isSheetPresented
    }

    @ViewBuilder private var statusInset: some View {
        if mutation.notice != nil || showsPendingBanner {
            VStack(spacing: Theme.Space.s3.points) {
                if let notice = mutation.notice {
                    MutationNoticeBanner(notice: notice, l10n: l10n) { mutation.dismissNotice() }
                }
                if showsPendingBanner { MutationPendingBanner(model: mutation, l10n: l10n) }
            }
            .padding(.horizontal)
            .padding(.vertical, Theme.Space.s3.points)
            .background(ThemeColor.canvas.color)
            .overlay(alignment: .top) { ThemeColor.borderSubtle.color.frame(height: 1) }
        }
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.draft.q }, set: { model.setSearchText($0) })
    }
}
