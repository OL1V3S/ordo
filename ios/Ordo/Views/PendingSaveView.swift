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
            if let save = model.pending { summarySection(save) }
            if model.phase == .uncertain || model.phase == .unreadable { actions }
        }
        .confirmationDialog(l10n.string(.captureDiscardConfirmTitle), isPresented: $confirmingDiscard,
                            titleVisibility: .visible) {
            Button(l10n.string(.captureDiscardConfirm), role: .destructive) { model.discard() }
            Button(l10n.string(.commonCancel), role: .cancel) {}
        } message: {
            Text(verbatim: l10n.string(.captureDiscardConfirmMessage))
        }
    }

    @ViewBuilder private var status: some View {
        switch model.phase {
        case .saving:
            HStack(spacing: 12) {
                ProgressView()
                Text(verbatim: l10n.string(.captureSaving))
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .uncertain:
            VStack(alignment: .leading, spacing: 8) {
                Label { Text(verbatim: l10n.string(.captureUncertainTitle)).font(.headline) } icon: {
                    Image(systemName: "exclamationmark.triangle")
                }
                Text(verbatim: l10n.string(model.isRecovered ? .captureUncertainRecoveredMessage : .captureUncertainMessage))
                    .font(.callout)
            }
            .accessibilityElement(children: .combine)
        case .unreadable:
            Label { Text(verbatim: l10n.string(.captureUnreadableMessage)) } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
        case .idle, .editing:
            EmptyView()
        }
    }

    private func summarySection(_ save: PendingSave) -> some View {
        let summary = CapturePresenter(l10n: l10n).summary(of: save)
        return Section {
            LabeledContent(l10n.string(.captureFieldsDescription), value: summary.description)
            LabeledContent(l10n.string(.captureFieldsAmount), value: summary.amount)
            LabeledContent(l10n.string(.captureFieldsDate), value: summary.date)
            if let category = summary.category {
                LabeledContent(l10n.string(.captureFieldsCategory), value: category)
            }
        } header: {
            Text(verbatim: summary.kind).accessibilityAddTraits(.isHeader)
        } footer: {
            Text(verbatim: l10n.string(.captureLocked))
        }
    }

    private var actions: some View {
        Section {
            if model.phase == .uncertain {
                Button { model.retry() } label: {
                    Text(verbatim: l10n.string(.captureRetry)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            Button(role: .destructive) { confirmingDiscard = true } label: {
                Text(verbatim: l10n.string(.captureDiscard)).frame(maxWidth: .infinity)
            }
        }
    }
}
