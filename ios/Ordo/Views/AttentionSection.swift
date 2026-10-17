import SwiftUI

struct AttentionSection: View {
    let state: SectionState<AttentionContent>
    let presenter: HomePresenter

    var body: some View {
        Section {
            switch state {
            case .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionMalformed), tone: .warning)
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionUnavailable), tone: .warning)
            case .available(let content):
                let rows = HomePresenter.attentionRows(content)
                if rows.isEmpty && !content.isPartial {
                    InlineStatusView(systemImage: "checkmark.circle", message: presenter.l10n.string(.homeAttentionEmpty), tone: .success)
                }
                ForEach(rows) { row in
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3.points) {
                        Image(systemName: glyph(for: row))
                            .foregroundStyle(tone(for: row).foreground.color)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                            Text(verbatim: presenter.title(for: row))
                                .font(Theme.Typography.rowTitle.font)
                                .foregroundStyle(ThemeColor.text.color)
                            Text(verbatim: presenter.detail(for: row))
                                .font(Theme.Typography.meta.font)
                                .foregroundStyle(ThemeColor.textMuted.color)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                if content.isPartial {
                    InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionPartialUnavailable), tone: .warning)
                }
            }
        } header: {
            Text(verbatim: presenter.l10n.string(.homeAttentionHeading)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    /// Budgets are a warning; recurring-expense reviews are information.
    private func tone(for row: AttentionRow) -> StatusTone {
        switch row {
        case .budget: .warning
        case .commitment: .info
        }
    }

    private func glyph(for row: AttentionRow) -> String {
        switch row {
        case .budget: "exclamationmark.triangle"
        case .commitment: "info.circle"
        }
    }
}
