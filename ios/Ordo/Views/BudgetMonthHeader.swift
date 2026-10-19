import SwiftUI

/// The budget month: Previous, the month label, Next and "This month". Stepping is blocked while a
/// form is open or a change is pending or unconfirmed, as on the web. The label is display only;
/// the month itself is an exact `YYYY-MM` key.
struct BudgetMonthHeader: View {
    let model: BudgetsViewModel
    let presenter: BudgetsPresenter
    @Environment(\.dynamicTypeSize) private var typeSize

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
            HStack(spacing: Theme.Space.s2.points) {
                Button { model.stepMonth(by: -1) } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(OrdoIconButtonStyle())
                    .disabled(!model.canStepBack)
                    .accessibilityLabel(Text(verbatim: l10n.string(.budgetsToolbarPreviousMonth)))
                Text(verbatim: presenter.monthLabel(model.month))
                    .font(Theme.Typography.rowTitle.font)
                    .foregroundStyle(ThemeColor.text.color)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: l10n.string(.budgetsToolbarMonth)))
                    .accessibilityValue(Text(verbatim: presenter.monthLabel(model.month)))
                Button { model.stepMonth(by: 1) } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(OrdoIconButtonStyle())
                    .disabled(!model.canStepForward)
                    .accessibilityLabel(Text(verbatim: l10n.string(.budgetsToolbarNextMonth)))
            }
            Button { model.goToCurrentMonth() } label: {
                Text(verbatim: l10n.string(.budgetsToolbarCurrentMonth)).frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil)
            }
            .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: typeSize.isAccessibilitySize))
            .disabled(!model.canGoToCurrentMonth)
        }
        .padding(.vertical, Theme.Space.s1.points)
    }
}
