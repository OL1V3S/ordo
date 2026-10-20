import SwiftUI

/// The in-flight or unknown state of a paycheck write. Every state has an icon or spinner plus text.
struct PaychecksStatusContent: View {
    let model: PaychecksViewModel
    let l10n: L10n

    var body: some View {
        switch model.writePhase {
        case .submitting:
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(.paychecksPageSaving))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .uncertain:
            VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
                VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                    Label {
                        Text(verbatim: l10n.string(.paychecksIosUncertainTitle))
                            .font(Theme.Typography.rowTitle.font)
                            .foregroundStyle(ThemeColor.text.color)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(StatusTone.warning.foreground.color)
                    }
                    Text(verbatim: l10n.string(.paychecksFeedbackUncertainWrite))
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.text.color)
                    if let code = model.retryConflictCode {
                        Text(verbatim: l10n.string(PaychecksPresenter.errorKey(code)))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.text.color)
                        Text(verbatim: l10n.string(.paychecksIosRetryConflictNote))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.text.color)
                    }
                }
                .accessibilityElement(children: .combine)
                Button { model.retry() } label: {
                    Text(verbatim: l10n.string(.captureRetry)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canRetry)
                Button { Task { await model.check() } } label: {
                    Text(verbatim: l10n.string(.paychecksIosCheck)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
                .disabled(model.isChecking)
            }
        case .idle:
            EmptyView()
        }
    }
}

/// Link a deposit (when the server lists a slot) and the lifecycle menu.
struct PaycheckActionsRow: View {
    let profile: PaycheckProfile
    let model: PaychecksViewModel
    let presenter: PaychecksPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        HStack(spacing: Theme.Space.s3.points) {
            if profile.canLinkDeposit {
                Button { model.beginReceipt(profile) } label: {
                    Text(verbatim: l10n.string(.paychecksActionsRecordReceived)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.paychecksActionsRecordReceivedLabel, profile.name)))
            }
            Spacer(minLength: 0)
            Menu {
                actionButtons
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .disabled(!model.canWrite)
            .accessibilityLabel(Text(verbatim: l10n.string(.paychecksActionsMenuLabel, profile.name)))
        }
    }

    /// The same items for the menu and a long press.
    @ViewBuilder var actionButtons: some View {
        ForEach(PaychecksViewModel.actions(for: profile.lifecycle), id: \.self) { action in
            Button(role: action == .end ? .destructive : nil) {
                model.perform(action, on: profile)
            } label: {
                Text(verbatim: presenter.actionTitle(action))
            }
            .accessibilityLabel(Text(verbatim: presenter.actionLabel(action, name: profile.name)))
        }
    }
}

/// The End and Remove confirmations, attached once per visible screen.
struct PaycheckDialogs: ViewModifier {
    let model: PaychecksViewModel
    let l10n: L10n
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .confirmationDialog(model.endTarget.map { l10n.string(.paychecksActionsEndPrompt, $0.name) } ?? "",
                                isPresented: Binding(get: { isActive && model.endTarget != nil },
                                                     set: { if !$0 { model.cancelEnd() } }),
                                titleVisibility: .visible, presenting: model.endTarget) { profile in
                Button(l10n.string(.paychecksActionsConfirmEnd), role: .destructive) { model.confirmEnd(profile) }
                Button(l10n.string(.paychecksActionsCancelEnding), role: .cancel) { model.cancelEnd() }
            }
            .confirmationDialog(l10n.string(.paychecksEvidenceRemovePrompt),
                                isPresented: Binding(get: { isActive && model.removeTarget != nil },
                                                     set: { if !$0 { model.cancelRemove() } }),
                                titleVisibility: .visible, presenting: model.removeTarget) { target in
                Button(l10n.string(.paychecksEvidenceRemoveConfirm), role: .destructive) { model.confirmRemove(target) }
                Button(l10n.string(.paychecksEvidenceRemoveCancel), role: .cancel) { model.cancelRemove() }
            }
    }
}

/// One linked deposit: description, posted date, source, timing, kind, edited flag and the exact amount.
struct PaycheckEvidenceRow: View {
    let profile: PaycheckProfile
    let evidence: PaycheckEvidence
    let model: PaychecksViewModel
    let presenter: PaychecksPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: evidence.text)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: presenter.money(evidence.amount))
                .themedAmount(direction: .moneyIn)
            Group {
                Text(verbatim: "\(presenter.date(evidence.postedDate)) · \(sourceText)")
                Text(verbatim: presenter.evidenceTiming(evidence))
                Text(verbatim: l10n.string(evidence.kind == .recordedReceipt ? .paychecksEvidenceReceivedPaycheck
                                                                             : .paychecksEvidenceConfirmationHistory))
                if evidence.edited { Text(verbatim: l10n.string(.paychecksEvidenceEdited)) }
            }
            .font(Theme.Typography.meta.font)
            .foregroundStyle(ThemeColor.textMuted.color)
            if evidence.isRemovable {
                Button { model.beginRemove(profile, evidence) } label: {
                    Text(verbatim: l10n.string(.paychecksEvidenceRemoveTrigger))
                }
                .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.paychecksEvidenceRemoveLabel, evidence.text)))
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var sourceText: String {
        switch evidence.source {
        case .imported: l10n.string(.paychecksEvidenceImported)
        case .manual: l10n.string(.paychecksEvidenceManual)
        case .unknown: ""
        }
    }
}
