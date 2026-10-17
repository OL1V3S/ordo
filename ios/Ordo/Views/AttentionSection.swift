import SwiftUI

struct AttentionSection: View {
    let state: SectionState<AttentionContent>
    let presenter: HomePresenter

    var body: some View {
        Section {
            switch state {
            case .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionMalformed))
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionUnavailable))
            case .available(let content):
                let rows = HomePresenter.attentionRows(content)
                if rows.isEmpty && !content.isPartial {
                    InlineStatusView(systemImage: "checkmark.circle", message: presenter.l10n.string(.homeAttentionEmpty))
                }
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: presenter.title(for: row)).font(.headline)
                        Text(verbatim: presenter.detail(for: row)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                if content.isPartial {
                    InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionPartialUnavailable))
                }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeAttentionHeading)).accessibilityAddTraits(.isHeader)
        }
    }
}
