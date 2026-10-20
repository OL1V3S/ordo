import SwiftUI

/// One statement row: what the statement says, flags, and the selection control. The toggles show
/// the server's value; a change is sent and shown only once the server answers.
struct ImportRowView: View {
    let model: ImportViewModel
    let row: ImportRow
    let presenter: ImportPresenter
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: presenter.rowTitle(row)).font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
                Spacer()
                Text(verbatim: presenter.amountText(row)).font(Theme.Typography.body.font).monospacedDigit()
            }
            HStack {
                Text(verbatim: presenter.dateText(row))
                Text(verbatim: presenter.statusLabel(row))
                if let direction = presenter.directionLabel(row) { Text(verbatim: direction) }
            }
            .font(Theme.Typography.meta.font).foregroundStyle(ThemeColor.textMuted.color)
            ForEach(Array(presenter.flags(row).enumerated()), id: \.offset) { _, flag in
                InlineStatusView(systemImage: flag.tone == .danger ? "exclamationmark.octagon" : "exclamationmark.triangle",
                                 message: flag.text, tone: flag.tone)
            }
            if row.isEligible {
                Toggle(presenter.text("row.selectLabel"), isOn: Binding(
                    get: { row.selectedForImport }, set: { model.setExpenseSelected(row, $0) }))
                    .disabled(!model.canEdit)
                Button(presenter.text("ios.editDetails"), action: edit).disabled(!model.canEdit)
                Text(verbatim: presenter.categoryLabel(row)).font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            } else if row.isInflowEligible {
                Toggle(presenter.text("row.depositLabel"), isOn: Binding(
                    get: { row.selectedForInflow }, set: { model.setDepositSelected(row, $0) }))
                    .disabled(!model.canEdit)
                Text(verbatim: presenter.text("row.qualification")).font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            } else {
                Text(verbatim: presenter.text("row.notSelectableLabel")).font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
        }
        .padding(.vertical, Theme.Space.s1.points)
    }
}
