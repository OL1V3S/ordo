import SwiftUI

struct RecentActivitySection: View {
    let state: RecentActivityState
    let presenter: HomePresenter
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Section {
            switch state {
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeActivityUnavailable), tone: .warning)
            case .available(let items) where items.isEmpty:
                InlineStatusView(systemImage: "tray", message: presenter.l10n.string(.homeActivityEmpty))
            case .available(let items):
                ForEach(items) { item in row(item) }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeActivityHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    private func row(_ item: ActivityItem) -> some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: Theme.Space.s1.points))
                                                  : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return layout {
            VStack(alignment: .leading, spacing: Theme.Space.s1.points / 2) {
                Text(verbatim: item.description)
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
                Text(verbatim: details(item))
                    .font(Theme.Typography.caption.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: Theme.Space.s2.points) }
            Text(verbatim: presenter.amount(for: item))
                .themedAmount(direction: HomePresenter.amountDirection(for: item))
        }
        .accessibilityElement(children: .combine)
    }

    private func details(_ item: ActivityItem) -> String {
        var parts = [presenter.kindLabel(item.kind), presenter.date(item.date)]
        if item.kind == .expense { parts.append(presenter.categoryLabel(item.category)) }
        if item.paycheckLinked { parts.append(presenter.l10n.string(.homeActivityPaycheckLinked)) }
        return parts.joined(separator: " · ")
    }
}
