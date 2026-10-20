import SwiftUI

/// "What is Ordo?" on the sign-in screen: a short tour of what is shipped today, in the web's
/// words. The note repeats the Reports caveat: figures are not a balance, savings or spendable money.
struct WhatIsOrdoView: View {
    let l10n: L10n
    @Environment(\.dismiss) private var dismiss

    private var items: [(title: L10nKey, detail: L10nKey)] {
        [(.navigationDestinationsHome, .authWhatIsOrdoHome),
         (.navigationDestinationsActivity, .authWhatIsOrdoTransactions),
         (.navigationDestinationsBudgets, .authWhatIsOrdoBudgets),
         (.commitmentsPageTitle, .authWhatIsOrdoCommitments),
         (.navigationDestinationsPaychecks, .authWhatIsOrdoPaychecks),
         (.navigationDestinationsInsights, .authWhatIsOrdoReports)]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4.points) {
                    Text(verbatim: l10n.string(.authWhatIsOrdoIntro))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.text.color)
                    ForEach(items, id: \.title) { item in
                        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                            Text(verbatim: l10n.string(item.title))
                                .font(Theme.Typography.rowTitle.font)
                                .foregroundStyle(ThemeColor.text.color)
                                .accessibilityAddTraits(.isHeader)
                            Text(verbatim: l10n.string(item.detail))
                                .font(Theme.Typography.meta.font)
                                .foregroundStyle(ThemeColor.textMuted.color)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    StatusBanner(tone: .neutral, systemImage: "info.circle", message: l10n.string(.authWhatIsOrdoNote))
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Space.s4.points)
            }
            .themedCanvas()
            .navigationTitle(l10n.string(.authWhatIsOrdoTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(l10n.string(.commonClose)) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
