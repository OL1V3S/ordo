import SwiftUI

struct HomeView: View {
    let model: HomeViewModel
    let l10n: L10n
    let signOut: () -> Void
    @State private var confirmingSignOut = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(l10n.string(.homePageTitle))
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(l10n.string(.commonSignOut)) { confirmingSignOut = true }
                    }
                }
                .confirmationDialog(l10n.string(.authSignOutConfirmTitle), isPresented: $confirmingSignOut,
                                    titleVisibility: .visible) {
                    Button(l10n.string(.commonSignOut), role: .destructive, action: signOut)
                    Button(l10n.string(.commonCancel), role: .cancel) {}
                } message: {
                    Text(verbatim: l10n.string(.authSignOutConfirmMessage))
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await model.reloadIfDateChanged() } }
                }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView(l10n.string(.homeLoadingHome)).frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityAddTraits(.updatesFrequently)
        case .loaded(let snapshot):
            let presenter = HomePresenter(l10n: l10n, currencyCode: snapshot.currencyCode)
            List {
                AttentionSection(state: snapshot.attention, presenter: presenter)
                RecentActivitySection(state: snapshot.recentActivity, presenter: presenter)
                UpcomingSection(state: snapshot.upcoming, presenter: presenter)
            }
            .refreshable { await model.refresh() }
        case .homeUnavailable:
            failure("exclamationmark.triangle", l10n.string(.homeActivityRequestUnavailable))
        case .offline:
            failure("wifi.slash", l10n.string(.appOffline))
        case .failed:
            failure("exclamationmark.triangle", l10n.string(.homeActivityRequestUnavailable))
        }
    }

    private func failure(_ icon: String, _ message: String) -> some View {
        ScrollView {
            StatusMessageView(systemImage: icon, message: message, retryTitle: l10n.string(.homeActivityRetry)) {
                Task { await model.load() }
            }
            .padding(.top, 40)
        }
        .refreshable { await model.refresh() }
        .onAppear { AccessibilityNotification.Announcement(message).post() }
    }
}
