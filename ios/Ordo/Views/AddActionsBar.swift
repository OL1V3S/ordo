import SwiftUI

/// The capture-first actions at the bottom of Home: Add expense is primary and Add deposit is
/// secondary, as on the web. Above them sit the last result and, when a save is waiting, a
/// banner that reopens it. Every status has an icon and text, never colour alone.
struct AddActionsBar: View {
    let model: CaptureViewModel
    let l10n: L10n
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: Theme.Space.s3.points) {
            if let notice = model.notice { noticeRow(notice) }
            if model.hasPending && !model.isSheetPresented { pendingBanner }
            actions
        }
        .padding(.horizontal)
        .padding(.vertical, Theme.Space.s3.points)
        // Opaque on every iOS version, so the buttons' contrast is defined. The iOS 26 scroll-edge
        // bar treatment is deferred to the slice that adds the tab bar.
        .background(ThemeColor.canvas.color)
        .overlay(alignment: .top) { ThemeColor.borderSubtle.color.frame(height: 1) }
    }

    private var actions: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: Theme.Space.s2.points))
                                                  : AnyLayout(HStackLayout(spacing: Theme.Space.s3.points))
        return layout {
            Button { model.begin(.expense) } label: {
                Text(verbatim: l10n.string(.captureAddExpense)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoPrimaryButtonStyle())
            Button { model.begin(.deposit) } label: {
                Text(verbatim: l10n.string(.captureAddDeposit)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
        }
        .disabled(!model.canBegin)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: l10n.string(.captureHeading)))
    }

    private func noticeRow(_ notice: CaptureViewModel.Notice) -> some View {
        StatusBanner(tone: Self.tone(for: notice), systemImage: Self.icon(for: notice),
                     message: l10n.string(CapturePresenter.noticeKey(notice))) {
            Button { model.dismissNotice() } label: { Image(systemName: "xmark") }
                .buttonStyle(OrdoIconButtonStyle())
                .accessibilityLabel(Text(verbatim: l10n.string(.commonClose)))
        }
    }

    private static func icon(for notice: CaptureViewModel.Notice) -> String {
        switch notice {
        case .saved: "checkmark.circle"
        case .savedRefreshFailed, .keyReused: "exclamationmark.triangle"
        case .recordDeleted: "info.circle"
        }
    }

    private static func tone(for notice: CaptureViewModel.Notice) -> StatusTone {
        switch notice {
        case .saved: .success
        case .savedRefreshFailed, .keyReused: .warning
        case .recordDeleted: .info
        }
    }

    private var pendingBanner: some View {
        StatusBanner(tone: .warning, systemImage: "exclamationmark.triangle",
                     message: l10n.string(.capturePendingTitle)) {
            Button(l10n.string(.capturePendingOpen)) { model.reopenSheet() }
                .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
        }
    }
}
