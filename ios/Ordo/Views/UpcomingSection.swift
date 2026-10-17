import SwiftUI

struct UpcomingSection: View {
    let state: SectionState<UpcomingContent>
    let presenter: HomePresenter

    var body: some View {
        Section {
            InlineStatusView(systemImage: "info.circle", message: presenter.l10n.string(.homeComingUpQualifier))
            switch state {
            case .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeComingUpMalformed))
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeComingUpUnavailable))
            case .available(let content) where content.items.isEmpty:
                InlineStatusView(systemImage: "calendar", message: presenter.l10n.string(.homeComingUpEmpty))
            case .available(let content):
                ForEach(content.items) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: item.displayName).font(.headline)
                        Text(verbatim: presenter.amountText(item.amount)).font(.subheadline)
                        Text(verbatim: presenter.windowText(item)).font(.subheadline).foregroundStyle(.secondary)
                        Text(verbatim: presenter.l10n.string(.homeComingUpCadence, presenter.cadenceLabel(item.cadence)))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: presenter.accessibilityLabel(item)))
                }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeComingUpHeading)).accessibilityAddTraits(.isHeader)
        }
    }
}
