import SwiftUI

/// The capture-first actions at the bottom of Home: Add expense is primary and Add deposit is
/// secondary, as on the web. Above them sit the last result and, when a save is waiting, a
/// banner that reopens it. Every status has an icon and text, never colour alone.
struct AddActionsBar: View {
    let model: CaptureViewModel
    let l10n: L10n
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: 12) {
            if let notice = model.notice { noticeRow(notice) }
            if model.hasPending && !model.isSheetPresented { pendingBanner }
            actions
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private var actions: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8))
                                                  : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            Button { model.begin(.expense) } label: {
                Text(verbatim: l10n.string(.captureAddExpense)).frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button { model.begin(.deposit) } label: {
                Text(verbatim: l10n.string(.captureAddDeposit)).frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .controlSize(.large)
        .disabled(!model.canBegin)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: l10n.string(.captureHeading)))
    }

    private func noticeRow(_ notice: CaptureViewModel.Notice) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Label { Text(verbatim: l10n.string(CapturePresenter.noticeKey(notice))) } icon: {
                Image(systemName: Self.icon(for: notice))
            }
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { model.dismissNotice() } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless)
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

    private var pendingBanner: some View {
        HStack(alignment: .center, spacing: 8) {
            Label { Text(verbatim: l10n.string(.capturePendingTitle)) } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(l10n.string(.capturePendingOpen)) { model.reopenSheet() }
                .buttonStyle(.bordered)
        }
    }
}
