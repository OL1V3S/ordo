import SwiftUI

/// One category budget: the category, a status, the used amount "of" the limit and, for a positive
/// limit with an exact comparison, a progress bar and the percent used. A single VoiceOver element
/// with Edit and Delete actions, trailing swipe actions and a context menu, all named after the
/// category. A row whose stored category is blank can only be deleted.
struct BudgetRow: View {
    let row: BudgetLimitRow
    let card: BudgetsPresenter.Card
    let presenter: BudgetsPresenter
    let canEdit: Bool
    let canDelete: Bool
    let edit: () -> Void
    let delete: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        rowContent
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: card.accessibilityLabel))
            .modifier(BudgetRowActions(row: row, presenter: presenter, canEdit: canEdit, canDelete: canDelete,
                                       edit: edit, delete: delete))
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
        VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            Text(verbatim: card.name)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Label {
                Text(verbatim: card.statusText)
                    .foregroundStyle(ThemeColor.text.color)
            } icon: {
                Image(systemName: card.warning ? "exclamationmark.triangle" : "circle.dashed")
                    .foregroundStyle((card.warning ? StatusTone.warning : StatusTone.neutral).foreground.color)
            }
            .font(Theme.Typography.meta.font)
            if let tenths = card.barTenths {
                ProgressView(value: Double(tenths), total: 1000)
                    .tint((card.warning ? StatusTone.warning.foreground : ThemeColor.accent).color)
                    .accessibilityLabel(Text(verbatim: card.progressLabel))
                    .accessibilityValue(Text(verbatim: card.progressValue ?? ""))
                if let percent = card.percentUsedText {
                    Text(verbatim: percent)
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                }
            }
            if let note = card.note {
                Text(verbatim: note)
                    .font(Theme.Typography.caption.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            amountLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var amountLine: some View {
        let stack = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.s1.points))
                                                 : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Theme.Space.s2.points))
        return stack {
            Text(verbatim: card.usedText)
                .themedAmount()
                .multilineTextAlignment(.leading)
            Text(verbatim: card.usedOfText)
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
    }
}

/// Swipe actions, a context menu and VoiceOver actions, named after the category as on the web.
private struct BudgetRowActions: ViewModifier {
    let row: BudgetLimitRow
    let presenter: BudgetsPresenter
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
                        Label(presenter.l10n.string(.budgetsCardDelete), systemImage: "trash")
                    }
                    .tint(ThemeColor.danger.color)
                }
                if canEdit {
                    Button(action: edit) {
                        Label(presenter.l10n.string(.budgetsCardEdit), systemImage: "pencil")
                    }
                    .tint(ThemeColor.accent.color)
                }
            }
            .contextMenu {
                if canEdit {
                    Button(action: edit) {
                        Label(presenter.l10n.string(.budgetsCardEdit), systemImage: "pencil")
                    }
                }
                if canDelete {
                    Button(role: .destructive, action: delete) {
                        Label(presenter.l10n.string(.budgetsCardDelete), systemImage: "trash")
                    }
                }
            }
            .accessibilityActions {
                if canEdit {
                    Button(presenter.editActionLabel(row), action: edit)
                }
                if canDelete {
                    Button(presenter.deleteActionLabel(row), action: delete)
                }
            }
    }
}
