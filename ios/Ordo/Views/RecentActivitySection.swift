import SwiftUI

struct RecentActivitySection: View {
    let state: RecentActivityState
    let presenter: HomePresenter
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Section {
            switch state {
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeActivityUnavailable))
            case .available(let items) where items.isEmpty:
                InlineStatusView(systemImage: "tray", message: presenter.l10n.string(.homeActivityEmpty))
            case .available(let items):
                ForEach(items) { item in row(item) }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeActivityHeading)).accessibilityAddTraits(.isHeader)
        }
    }

    private func row(_ item: ActivityItem) -> some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                                                  : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return layout {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.description).font(.body)
                Text(verbatim: details(item)).font(.caption).foregroundStyle(.secondary)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            Text(verbatim: presenter.amount(for: item)).font(.body.monospacedDigit())
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
