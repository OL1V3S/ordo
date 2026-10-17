import SwiftUI

struct UpcomingSection: View {
    let state: SectionState<UpcomingContent>
    let presenter: HomePresenter

    var body: some View {
        Section {
            InlineStatusView(systemImage: "info.circle", message: presenter.l10n.string(.homeComingUpQualifier))
            switch state {
            case .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeComingUpMalformed), tone: .warning)
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeComingUpUnavailable), tone: .warning)
            case .available(let content) where content.items.isEmpty:
                InlineStatusView(systemImage: "calendar", message: presenter.l10n.string(.homeComingUpEmpty))
            case .available(let content):
                ForEach(content.items) { item in
                    VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                        Text(verbatim: item.displayName)
                            .font(Theme.Typography.rowTitle.font)
                            .foregroundStyle(ThemeColor.text.color)
                        // Upcoming paycheck amounts stay neutral: they are expected, not recorded.
                        Text(verbatim: presenter.amountText(item.amount))
                            .themedAmount()
                        Text(verbatim: presenter.windowText(item))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.textMuted.color)
                        Text(verbatim: presenter.l10n.string(.homeComingUpCadence, presenter.cadenceLabel(item.cadence)))
                            .font(Theme.Typography.caption.font)
                            .foregroundStyle(ThemeColor.textMuted.color)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: presenter.accessibilityLabel(item)))
                }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeComingUpHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }
}
