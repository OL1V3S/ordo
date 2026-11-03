import SwiftUI

struct AttentionSection: View {
    let state: SectionState<AttentionContent>
    let presenter: HomePresenter
    /// Opens Plan, Recurring expenses at Changes to review. Off while a write is in flight.
    var reviewsEnabled = true
    var openReviews: () -> Void = {}
    var paycheckAttention: PaycheckAttentionState = .absent
    var openPaychecks: () -> Void = {}

    var body: some View {
        if HomePresenter.showsAttention(state, paycheckAttention) { section }
    }

    private var section: some View {
        Section {
            switch state {
            case .malformed:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionMalformed), tone: .warning)
            case .unavailable:
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionUnavailable), tone: .warning)
            case .available(let content):
                if content.isPartial {
                    InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionPartialUnavailable), tone: .warning)
                }
            }
            if case .unavailable = paycheckAttention, case .available(let content) = state, !content.isPartial {
                InlineStatusView(systemImage: "exclamationmark.triangle", message: presenter.l10n.string(.homeAttentionPartialUnavailable), tone: .warning)
            }
            ForEach(HomePresenter.allRows(state, paycheckAttention)) { row in
                if case .paycheck = row {
                    Button { openPaychecks() } label: { rowContent(row) }
                } else {
                    rowContent(row)
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

    private func rowContent(_ row: AttentionRow) -> some View {
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

    /// Budgets are a warning; recurring-expense reviews are information.
    private func tone(for row: AttentionRow) -> StatusTone {
        switch row {
        case .budget: .warning
        case .commitment: .info
        case .paycheck: .info
        }
    }

    private func glyph(for row: AttentionRow) -> String {
        switch row {
        case .budget: "exclamationmark.triangle"
        case .commitment: "info.circle"
        case .paycheck: "calendar"
        }
    }
}
