import SwiftUI

/// The locked values of a save, with its state: saving, uncertain (retry or discard), or an
/// unreadable record (discard only). Nothing here can be edited.
struct PendingSaveView: View {
    let model: CaptureViewModel
    let l10n: L10n
    @State private var confirmingDiscard = false

    var body: some View {
        Form {
            Section { status }
                .themedToneRow(statusTone)
            if let save = model.pending { summarySection(save) }
            if model.phase == .uncertain || model.phase == .unreadable { actions }
        }
        .themedList()
        .confirmationDialog(l10n.string(.captureDiscardConfirmTitle), isPresented: $confirmingDiscard,
                            titleVisibility: .visible) {
            Button(l10n.string(.captureDiscardConfirm), role: .destructive) { model.discard() }
            Button(l10n.string(.commonCancel), role: .cancel) {}
        } message: {
            Text(verbatim: l10n.string(.captureDiscardConfirmMessage))
        }
    }

    /// Saving is neutral, uncertain is a warning and an unreadable record is an error.
    private var statusTone: StatusTone {
        switch model.phase {
        case .uncertain: .warning
        case .unreadable: .danger
        case .saving, .idle, .editing: .neutral
        }
    }

    @ViewBuilder private var status: some View {
        let tone = statusTone
        switch model.phase {
        case .saving:
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(.captureSaving))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .uncertain:
            VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                Label {
                    Text(verbatim: l10n.string(.captureUncertainTitle))
                        .font(Theme.Typography.rowTitle.font)
                        .foregroundStyle(ThemeColor.text.color)
                } icon: {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(tone.foreground.color)
                }
                Text(verbatim: l10n.string(model.isRecovered ? .captureUncertainRecoveredMessage : .captureUncertainMessage))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            .accessibilityElement(children: .combine)
        case .unreadable:
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(.captureUnreadableMessage), tone: tone)
        case .idle, .editing:
            EmptyView()
        }
    }

    private func summarySection(_ save: PendingSave) -> some View {
        let summary = CapturePresenter(l10n: l10n).summary(of: save)
        return Section {
            summaryRow(l10n.string(.captureFieldsDescription), summary.description)
            summaryRow(l10n.string(.captureFieldsAmount), summary.amount)
            summaryRow(l10n.string(.captureFieldsDate), summary.date)
            if let category = summary.category {
                summaryRow(l10n.string(.captureFieldsCategory), category)
            }
        } header: {
            Text(verbatim: summary.kind).themedSectionHeader().accessibilityAddTraits(.isHeader)
        } footer: {
            Text(verbatim: l10n.string(.captureLocked))
                .font(Theme.Typography.finePrint.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .themedRows()
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(verbatim: value).foregroundStyle(ThemeColor.text.color)
        } label: {
            Text(verbatim: label).foregroundStyle(ThemeColor.textMuted.color)
        }
    }

    private var actions: some View {
        Section {
            if model.phase == .uncertain {
                Button { model.retry() } label: {
                    Text(verbatim: l10n.string(.captureRetry)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
            }
            Button(role: .destructive) { confirmingDiscard = true } label: {
                Text(verbatim: l10n.string(.captureDiscard)).frame(maxWidth: .infinity)
            }
            .buttonStyle(OrdoDestructiveButtonStyle())
        }
        .themedButtonRow()
    }
}
