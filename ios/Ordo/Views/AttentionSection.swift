import SwiftUI

struct AttentionSection: View {
    let state: SectionState<AttentionContent>
    let presenter: HomePresenter
    /// Opens Plan, Recurring expenses at Changes to review. Off while a write is in flight.
    var reviewsEnabled = true
    var openReviews: () -> Void = {}

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
            if let link = HomePresenter.attentionLink(state) {
                Button { openReviews() } label: {
                    HStack {
                        Text(verbatim: presenter.title(for: link))
                            .font(Theme.Typography.rowTitle.font)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").accessibilityHidden(true)
                    }
                    .foregroundStyle(reviewsEnabled ? ThemeColor.accent.color : ThemeColor.textMuted.color)
                }
                .disabled(!reviewsEnabled)
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
