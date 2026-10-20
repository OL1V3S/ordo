import SwiftUI

struct HomeView: View {
    let model: HomeViewModel
    let capture: CaptureViewModel
    let reports: ReportsViewModel
    /// An edit or delete is on its way to the server: one write at a time.
    let writeBlocked: Bool
    let l10n: L10n
    /// For Settings (appearance, language and sign-out).
    let app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            content
                .themedCanvas()
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    // Capture does not depend on the Home read, so it stays available in every
                    // phase except the first load.
                    if model.phase != .loading || capture.hasPending || capture.notice != nil {
                        AddActionsBar(model: capture, writeBlocked: writeBlocked, l10n: l10n)
                    }
                }
                .navigationTitle(l10n.string(.homePageTitle))
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        NavigationLink {
                            ReportsView(model: reports, l10n: l10n)
                        } label: {
                            Label(l10n.string(.navigationDestinationsInsights), systemImage: "chart.bar.xaxis")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink {
                            SettingsView(model: app, l10n: l10n)
                        } label: {
                            Label(l10n.string(.settingsTitle), systemImage: "gearshape")
                        }
                    }
                }
                .sheet(isPresented: Binding(get: { capture.isSheetPresented },
                                            set: { if !$0 { capture.sheetDismissed() } })) {
                    CaptureSheet(model: capture, writeBlocked: writeBlocked, l10n: l10n)
                }
                .onChange(of: capture.notice) { _, notice in
                    if let notice { AccessibilityNotification.Announcement(l10n.string(CapturePresenter.noticeKey(notice))).post() }
                }
                // A small success tap, only when a save is confirmed (never for the other notices).
                .sensoryFeedback(.success, trigger: capture.notice) { _, notice in
                    if case .saved = notice { true } else { false }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.reloadIfDateChanged() } }
                }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView(l10n.string(.homeLoadingHome))
                .tint(ThemeColor.accent.color)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityAddTraits(.updatesFrequently)
        case .loaded(let snapshot):
            let presenter = HomePresenter(l10n: l10n, currencyCode: snapshot.currencyCode)
            List {
                AttentionSection(state: snapshot.attention, presenter: presenter)
                RecentActivitySection(state: snapshot.recentActivity, presenter: presenter)
                UpcomingSection(state: snapshot.upcoming, presenter: presenter)
            }
            .themedList()
            .refreshable { await model.refresh() }
        case .homeUnavailable:
            failure("exclamationmark.triangle", l10n.string(.homeActivityRequestUnavailable), tone: .warning)
        case .offline:
            failure("wifi.slash", l10n.string(.appOffline), tone: .neutral)
        case .failed:
            failure("exclamationmark.triangle", l10n.string(.homeActivityRequestUnavailable), tone: .danger)
        }
    }

    private func failure(_ icon: String, _ message: String, tone: StatusTone) -> some View {
        ScrollView {
            StatusMessageView(systemImage: icon, message: message, tone: tone,
                              retryTitle: l10n.string(.homeActivityRetry)) {
                Task { await model.load() }
            }
            .padding(.top, Theme.Space.s7.points)
        }
        .refreshable { await model.refresh() }
        .onAppear { AccessibilityNotification.Announcement(message).post() }
    }
}
