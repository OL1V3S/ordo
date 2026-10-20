import SwiftUI

/// Where a row leads.
enum RecurringRoute: Hashable {
    case commitment(String)
    case candidate(String)
}

/// The Recurring expenses tab: confirmed recurring expenses (expected, never recorded spending) and
/// the possible ones the server detected, with the decisions on them. Everything shown is what the
/// server last reported; after a decision both lists are read again.
struct RecurringView: View {
    let model: RecurringViewModel
    let l10n: L10n
    @State private var path: [RecurringRoute] = []

    private var presenter: RecurringPresenter { RecurringPresenter(l10n: l10n) }

    var body: some View {
        NavigationStack(path: $path) {
            list
                .themedCanvas()
                .navigationTitle(l10n.string(.commitmentsPageTitle))
                .navigationDestination(for: RecurringRoute.self) { route in
                    RecurringDetailView(model: model, route: route, presenter: presenter)
                }
                .modifier(RecurringDialogs(model: model, l10n: l10n, isActive: path.isEmpty))
                .task { await model.loadIfNeeded() }
                .onChange(of: model.notice) { _, notice in
                    if let notice { AccessibilityNotification.Announcement(l10n.string(RecurringPresenter.noticeKey(notice))).post() }
                }
                .sensoryFeedback(.success, trigger: model.notice) { _, notice in
                    switch notice {
                    case .confirmed?, .dismissed?, .reconsidered?, .lifecycle?: true
                    default: false
                    }
                }
        }
        .sheet(isPresented: Binding(get: { model.isSheetPresented }, set: { if !$0 { model.sheetDismissed() } })) {
            ConfirmCommitmentSheet(model: model, presenter: presenter)
        }
    }

    private var list: some View {
        List {
            Section {
                Text(verbatim: l10n.string(.commitmentsPageSubtitle))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            .themedRows()

            statusSection

            if model.listState == .loaded {
                activeSection
                candidatesSection
                ForEach([RecurringViewModel.Group.paused, .ended], id: \.self) { group in
                    commitmentGroup(group)
                }
                dismissedSection
            }
        }
        .themedList()
        .refreshable { await model.refresh() }
    }

    // MARK: Status

    private var statusSection: some View {
        Section {
            switch model.listState {
            case .idle, .loading:
                progressRow(l10n.string(.commitmentsFeedbackLoading))
            case .failed, .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: l10n.string(.commitmentsIosLoadFailed), tone: .danger)
                InlineStatusView(systemImage: "info.circle", message: l10n.string(.commitmentsFeedbackOutOfDate), tone: .info)
            case .loaded:
                EmptyView()
            }
            if model.isRefreshing && model.listState == .loaded { progressRow(l10n.string(.commitmentsFeedbackRefreshing)) }
            if model.writePhase != .idle && !model.isSheetPresented { RecurringStatusContent(model: model, l10n: l10n) }
            if let notice = model.notice {
                StatusBanner(tone: RecurringPresenter.noticeTone(notice), systemImage: RecurringPresenter.noticeIcon(notice),
                             message: l10n.string(RecurringPresenter.noticeKey(notice))) {
                    Button { model.dismissNotice() } label: { Image(systemName: "xmark") }
                        .buttonStyle(OrdoIconButtonStyle())
                        .accessibilityLabel(Text(verbatim: l10n.string(.commonClose)))
                }
            }
            Button { Task { await model.refresh() } } label: {
                Text(verbatim: l10n.string(model.listState == .failed || model.listState == .malformed
                                           ? .commitmentsFeedbackTryAgain : .commitmentsFeedbackRefresh)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
            .disabled(model.listState == .loading || model.isRefreshing)
        }
        .themedRows()
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

    // MARK: Sections

    @ViewBuilder private var activeSection: some View {
        let active = model.commitments(in: .active)
        Section {
            if active.isEmpty {
                Text(verbatim: l10n.string(model.snapshot?.commitments.isEmpty == true ? .commitmentsSavedEmptyNone
                                                                                         : .commitmentsSavedEmptyNoActive))
                    .font(Theme.Typography.rowTitle.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            ForEach(active) { commitmentRows($0) }
        } header: {
            Text(verbatim: l10n.string(.commitmentsSavedHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private var candidatesSection: some View {
        let candidates = model.snapshot?.candidates ?? []
        Section {
            Text(verbatim: l10n.string(.commitmentsCandidatesIntro))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            if candidates.isEmpty {
                Text(verbatim: l10n.string(.commitmentsCandidatesEmpty))
                    .font(Theme.Typography.rowTitle.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            ForEach(candidates) { candidateRows($0, dismissed: false) }
        } header: {
            Text(verbatim: "\(l10n.string(.commitmentsCandidatesHeading)) · \(l10n.string(.commitmentsCandidatesToReview, String(candidates.count)))")
                .themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private func commitmentGroup(_ group: RecurringViewModel.Group) -> some View {
        let lifecycle: CommitmentLifecycle = group == .paused ? .paused : .ended
        let rows = model.commitments(in: lifecycle)
        if !rows.isEmpty {
            Section {
                groupToggle(group, count: rows.count)
                if model.expanded.contains(group) { ForEach(rows) { commitmentRows($0) } }
            }
            .themedRows()
        }
    }

    @ViewBuilder private var dismissedSection: some View {
        let dismissed = model.snapshot?.dismissed ?? []
        Section {
            groupToggle(.dismissed, count: dismissed.count)
            if model.expanded.contains(.dismissed) {
                Text(verbatim: l10n.string(.commitmentsHistoryDismissedIntro))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                if dismissed.isEmpty {
                    Text(verbatim: l10n.string(.commitmentsHistoryDismissedEmpty))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                }
                ForEach(dismissed) { candidateRows($0, dismissed: true) }
            }
        }
        .themedRows()
    }

    private func groupToggle(_ group: RecurringViewModel.Group, count: Int) -> some View {
        Button { model.toggleGroup(group) } label: {
            HStack {
                Text(verbatim: "\(presenter.groupHeading(group)) (\(count))")
                    .font(Theme.Typography.rowTitle.font)
                    .foregroundStyle(ThemeColor.text.color)
                Spacer()
                Image(systemName: model.expanded.contains(group) ? "chevron.up" : "chevron.down")
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
        }
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(Text(verbatim: model.expanded.contains(group) ? "" : l10n.string(.commitmentsIosShowGroup)))
    }

    @ViewBuilder private func commitmentRows(_ commitment: RecurringCommitment) -> some View {
        NavigationLink(value: RecurringRoute.commitment(commitment.id)) {
            CommitmentRow(commitment: commitment, presenter: presenter)
        }
        .contextMenu { CommitmentActionsRow(commitment: commitment, model: model, presenter: presenter).actionButtons }
        CommitmentActionsRow(commitment: commitment, model: model, presenter: presenter)
    }

    @ViewBuilder private func candidateRows(_ candidate: RecurringCandidate, dismissed: Bool) -> some View {
        NavigationLink(value: RecurringRoute.candidate(candidate.fingerprint)) {
            CandidateRow(candidate: candidate, dismissed: dismissed, presenter: presenter)
        }
        CandidateActionsRow(candidate: candidate, dismissed: dismissed, model: model, presenter: presenter)
    }
}
