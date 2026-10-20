import SwiftUI

/// The month picker: Earlier, the month menu, Later and "This month". Months are the listed ones
/// (current, selected and every month with records), as on the web.
struct ReportsMonthHeader: View {
    let model: ReportsViewModel
    let presenter: ReportsPresenter
    @Environment(\.dynamicTypeSize) private var typeSize

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
            HStack(spacing: Theme.Space.s2.points) {
                Button { Task { await model.stepEarlier() } } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(OrdoIconButtonStyle())
                    .disabled(!model.canStepEarlier)
                    .accessibilityLabel(Text(verbatim: l10n.string(.analyticsPageEarlierMonth)))
                Picker(l10n.string(.analyticsPageMonth), selection: Binding(get: { model.month },
                                                                         set: { value in Task { await model.select(value) } })) {
                    ForEach(model.monthOptions, id: \.self) { option in
                        Text(verbatim: presenter.monthLabel(option)).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(ThemeColor.text.color)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text(verbatim: l10n.string(.analyticsPageMonth)))
                .accessibilityValue(Text(verbatim: presenter.monthLabel(model.month)))
                Button { Task { await model.stepLater() } } label: { Image(systemName: "chevron.right") }
                    .buttonStyle(OrdoIconButtonStyle())
                    .disabled(!model.canStepLater)
                    .accessibilityLabel(Text(verbatim: l10n.string(.analyticsPageLaterMonth)))
            }
            Button { Task { await model.goToCurrentMonth() } } label: {
                Text(verbatim: l10n.string(.analyticsPageCurrentMonth)).frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil)
            }
            .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: typeSize.isAccessibilitySize))
            .disabled(!model.canGoToCurrentMonth)
        }
        .padding(.vertical, Theme.Space.s1.points)
    }
}
