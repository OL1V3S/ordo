import SwiftUI

/// One timeline row: a single VoiceOver element with Edit and Delete actions, trailing swipe
/// actions and a context menu. An expense whose stored amount is not a positive exact amount has
/// Delete only.
struct TransactionRow: View {
    let item: TimelineItem
    let presenter: TransactionsPresenter
    /// Edit and Delete are available (nothing else is open or saving).
    let actionsEnabled: Bool
    let edit: () -> Void
    let delete: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var canEdit: Bool { actionsEnabled && TransactionsPresenter.canEdit(item) }
    private var l10n: L10n { presenter.l10n }

    var body: some View {
        rowContent
            .accessibilityElement(children: .combine)
            .modifier(RowActions(item: item, presenter: presenter, canEdit: canEdit,
                                 canDelete: actionsEnabled, edit: edit, delete: delete))
    }

    @ViewBuilder private var rowContent: some View {
        if canEdit {
            Button(action: edit) { layout }
                .buttonStyle(.plain)
        } else {
            layout
        }
    }

    private var layout: some View {
        let stack = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.s1.points))
                                                 : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return stack {
            VStack(alignment: .leading, spacing: Theme.Space.s1.points / 2) {
                Text(verbatim: item.descriptionText)
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
                Text(verbatim: presenter.details(item))
                    .font(Theme.Typography.caption.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: Theme.Space.s2.points) }
            amount
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var amount: some View {
        if let stored = presenter.storedAmountText(item) {
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: Theme.Space.s1.points / 2) {
                Text(verbatim: presenter.amountText(item))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.text.color)
                Text(verbatim: stored)
                    .font(Theme.Typography.caption.font.monospacedDigit())
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
        } else {
            Text(verbatim: presenter.amountText(item))
                .themedAmount(direction: TransactionsPresenter.direction(for: item))
        }
    }
}

/// Swipe actions, a context menu and VoiceOver actions, all named after the record as on the web.
private struct RowActions: ViewModifier {
    let item: TimelineItem
    let presenter: TransactionsPresenter
    let canEdit: Bool
    let canDelete: Bool
    let edit: () -> Void
    let delete: () -> Void

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canDelete {
                    // Not `.destructive`: the row must not animate away before the confirmation and
                    // the server result.
                    Button(action: delete) {
                        Label(presenter.l10n.string(.timelineActionsDelete), systemImage: "trash")
                    }
                    .tint(ThemeColor.danger.color)
                }
                if canEdit {
                    Button(action: edit) {
                        Label(presenter.l10n.string(.timelineActionsEdit), systemImage: "pencil")
                    }
                    .tint(ThemeColor.accent.color)
                }
            }
            .contextMenu {
                if canEdit {
                    Button(action: edit) {
                        Label(presenter.l10n.string(.timelineActionsEdit), systemImage: "pencil")
                    }
                }
                if canDelete {
                    Button(role: .destructive, action: delete) {
                        Label(presenter.l10n.string(.timelineActionsDelete), systemImage: "trash")
                    }
                }
            }
            .accessibilityActions {
                if canEdit {
                    Button(presenter.editActionLabel(item), action: edit)
                }
                if canDelete {
                    Button(presenter.deleteActionLabel(item), action: delete)
                }
            }
    }
}
