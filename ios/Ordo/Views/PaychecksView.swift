import SwiftUI

/// Paychecks, in the Plan tab: the user's pay schedules with their expected (never received) amounts and
/// windows, the lifecycle actions, and linking or removing a received paycheck. Everything shown is
/// what the server last reported; after a change the schedules are read again.
struct PaychecksView: View {
    let model: PaychecksViewModel
    let l10n: L10n
    /// The Plan switcher on this root screen.
    @Binding var planSection: PlanSection
    let planSwitchEnabled: Bool
    @State private var path: [String] = []

    private var presenter: PaychecksPresenter { PaychecksPresenter(l10n: l10n) }

    var body: some View {
        NavigationStack(path: $path) {
            list
                .planSwitcher($planSection, isEnabled: planSwitchEnabled, l10n: l10n)
                .themedCanvas()
                .navigationTitle(l10n.string(.paychecksPageTitle))
                .navigationDestination(for: String.self) { id in
                    PaycheckDetailView(model: model, profileId: id, presenter: presenter)
                }
                .modifier(PaycheckDialogs(model: model, l10n: l10n, isActive: path.isEmpty))
                .task { await model.loadIfNeeded() }
                .onChange(of: model.notice) { _, notice in
                    if let notice { AccessibilityNotification.Announcement(l10n.string(PaychecksPresenter.noticeKey(notice))).post() }
                }
                .sensoryFeedback(.success, trigger: model.notice) { _, notice in
                    switch notice {
                    case .lifecycle?, .receiptRecorded?, .receiptRemoved?: true
                    default: false
                    }
                }
        }
        .sheet(isPresented: Binding(get: { model.isSheetPresented }, set: { if !$0 { model.sheetDismissed() } })) {
            RecordReceiptSheet(model: model, presenter: presenter)
        }
    }

    private var list: some View {
        List {
            Section {
                Text(verbatim: l10n.string(.paychecksPageIntro))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            .themedRows()

            statusSection

            if model.listState == .loaded {
                activeSection
                ForEach([PaycheckLifecycle.paused, .ended], id: \.self) { lifecycle in
                    groupSection(lifecycle)
                }
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
                progressRow(l10n.string(.paychecksPageLoading))
            case .failed, .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle",
                                 message: l10n.string(.paychecksFeedbackLoadFailed), tone: .danger)
            case .loaded:
                EmptyView()
            }
            if model.isRefreshing && model.listState == .loaded { progressRow(l10n.string(.paychecksPageRefreshing)) }
            if model.writePhase != .idle && !model.isSheetPresented { PaychecksStatusContent(model: model, l10n: l10n) }
            if let notice = model.notice {
                StatusBanner(tone: PaychecksPresenter.noticeTone(notice), systemImage: PaychecksPresenter.noticeIcon(notice),
                             message: l10n.string(PaychecksPresenter.noticeKey(notice))) {
                    Button { model.dismissNotice() } label: { Image(systemName: "xmark") }
                        .buttonStyle(OrdoIconButtonStyle())
                        .accessibilityLabel(Text(verbatim: l10n.string(.commonClose)))
                }
            }
            Button { Task { await model.refresh() } } label: {
                Text(verbatim: l10n.string(.paychecksPageRefresh)).frame(maxWidth: .infinity)
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

    // MARK: Groups

    @ViewBuilder private var activeSection: some View {
        let active = model.profiles(in: .active)
        Section {
            if active.isEmpty {
                VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                    Text(verbatim: l10n.string(model.snapshot?.profiles.isEmpty == true ? .paychecksProfilesEmptyNone
                                                                                          : .paychecksProfilesEmptyNoActive))
                        .font(Theme.Typography.rowTitle.font)
                        .foregroundStyle(ThemeColor.text.color)
                    Text(verbatim: l10n.string(.paychecksIosEmptyBody))
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                }
            }
            ForEach(active) { rows(for: $0) }
        } header: {
            Text(verbatim: l10n.string(.paychecksProfilesHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private func groupSection(_ lifecycle: PaycheckLifecycle) -> some View {
        let profiles = model.profiles(in: lifecycle)
        if !profiles.isEmpty {
            Section {
                Button { model.toggleGroup(lifecycle) } label: {
                    HStack {
                        Text(verbatim: "\(presenter.groupHeading(lifecycle)) (\(profiles.count))")
                            .font(Theme.Typography.rowTitle.font)
                            .foregroundStyle(ThemeColor.text.color)
                        Spacer()
                        Image(systemName: model.expanded.contains(lifecycle) ? "chevron.up" : "chevron.down")
                            .foregroundStyle(ThemeColor.textMuted.color)
                    }
                }
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(Text(verbatim: model.expanded.contains(lifecycle) ? "" : l10n.string(.paychecksIosShowGroup)))
                if model.expanded.contains(lifecycle) {
                    ForEach(profiles) { rows(for: $0) }
                }
            }
            .themedRows()
        }
    }

    @ViewBuilder private func rows(for profile: PaycheckProfile) -> some View {
        NavigationLink(value: profile.id) {
            PaycheckRow(profile: profile, presenter: presenter)
        }
        .contextMenu { PaycheckActionsRow(profile: profile, model: model, presenter: presenter).actionButtons }
        PaycheckActionsRow(profile: profile, model: model, presenter: presenter)
    }
}

/// A schedule's summary. Expected money is labelled as expected and never as received.
struct PaycheckRow: View {
    let profile: PaycheckProfile
    let presenter: PaychecksPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: profile.name)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: "\(presenter.lifecycle(profile.lifecycle)) · \(presenter.cadence(of: profile))")
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: "\(l10n.string(.paychecksCardExpectedAmount)): \(presenter.amount(profile.amount))")
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: profile.lifecycle == .active
                 ? "\(l10n.string(.paychecksCardNextWindow)): \(presenter.nextWindow(profile))" : presenter.nextWindow(profile))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            if profile.lifecycle == .active && profile.projection != nil {
                Text(verbatim: l10n.string(.paychecksCardNotGuaranteed))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            Text(verbatim: "\(l10n.string(.paychecksFactsLinkedDeposits)): \(presenter.linkedCount(profile))")
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presenter.accessibilitySummary(profile)))
        .accessibilityHint(Text(verbatim: l10n.string(.paychecksCardDetailsLabel, profile.name)))
    }
}
