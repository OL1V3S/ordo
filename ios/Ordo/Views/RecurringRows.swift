import SwiftUI

/// A confirmed recurring expense's summary. Expected money is labelled as expected and never as spent.
struct CommitmentRow: View {
    let commitment: RecurringCommitment
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: commitment.name)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: "\(presenter.lifecycle(commitment.lifecycle)) · \(presenter.categoryAndCadence(category: commitment.category, cadence: commitment.timing.cadence))")
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: presenter.timingSummary(commitment.timing))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: "\(l10n.string(.commitmentsSavedExpectedAmount)): \(presenter.amount(commitment.amount))")
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presenter.accessibilitySummary(commitment)))
        .accessibilityHint(Text(verbatim: l10n.string(.commitmentsSavedDetailsLabel, commitment.name)))
    }
}

/// A possible recurring expense's summary. The amount is what the server observed, not a saved amount.
struct CandidateRow: View {
    let candidate: RecurringCandidate
    let dismissed: Bool
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: candidate.name)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            if dismissed {
                Text(verbatim: l10n.string(.commitmentsCandidatesDismissedStatus))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
            }
            Text(verbatim: presenter.categoryAndCadence(category: candidate.category, cadence: candidate.timing.cadence))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: presenter.basedOn(candidate))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: "\(l10n.string(candidate.observedFixed ? .commitmentsCandidatesObservedAmount : .commitmentsCandidatesObservedAmountRange)): \(presenter.observedAmount(candidate))")
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presenter.accessibilitySummary(candidate, dismissed: dismissed)))
    }
}

/// Pause, Reactivate and End, as a trailing button and a menu.
struct CommitmentActionsRow: View {
    let commitment: RecurringCommitment
    let model: RecurringViewModel
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        HStack(spacing: Theme.Space.s3.points) {
            if commitment.lifecycle != .active {
                Button { model.perform(.reactivate, on: commitment) } label: {
                    Text(verbatim: l10n.string(.commitmentsSavedReactivate)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsSavedReactivateLabel, commitment.name)))
            }
            Spacer(minLength: 0)
            Menu {
                actionButtons
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .disabled(!model.canWrite)
            .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsActionsMenuLabel, commitment.name)))
        }
    }

    /// The same items for the menu and a long press (Reactivate is also the trailing button).
    @ViewBuilder var actionButtons: some View {
        ForEach(RecurringViewModel.actions(for: commitment.lifecycle), id: \.self) { action in
            Button(role: action == .end ? .destructive : nil) {
                model.perform(action, on: commitment)
            } label: {
                Text(verbatim: presenter.actionTitle(action))
            }
            .accessibilityLabel(Text(verbatim: presenter.actionLabel(action, name: commitment.name)))
        }
    }
}

/// Review and confirm plus a Dismiss menu, or Review again for a dismissed one.
struct CandidateActionsRow: View {
    let candidate: RecurringCandidate
    let dismissed: Bool
    let model: RecurringViewModel
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        HStack(spacing: Theme.Space.s3.points) {
            if dismissed {
                Button { model.reconsider(candidate) } label: {
                    Text(verbatim: l10n.string(.commitmentsCandidatesReconsider)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsCandidatesReconsiderLabel, candidate.name)))
            } else {
                Button { model.beginConfirm(candidate) } label: {
                    Text(verbatim: l10n.string(.commitmentsCandidatesReviewAndConfirm)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsCandidatesReviewAndConfirmLabel, candidate.name)))
                Menu {
                    Button { model.dismiss(candidate) } label: {
                        Text(verbatim: l10n.string(.commitmentsCandidatesDismiss))
                    }
                    .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsCandidatesDismissLabel, candidate.name)))
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .disabled(!model.canWrite)
                .accessibilityLabel(Text(verbatim: l10n.string(.commitmentsActionsMenuLabel, candidate.name)))
            }
        }
    }
}

/// The in-flight or unknown state of a recurring-expense write. Every state has an icon or spinner plus text.
struct RecurringStatusContent: View {
    let model: RecurringViewModel
    let l10n: L10n

    var body: some View {
        switch model.writePhase {
        case .submitting:
            HStack(spacing: Theme.Space.s3.points) {
                ProgressView().tint(ThemeColor.accent.color)
                Text(verbatim: l10n.string(.commitmentsFeedbackSaving))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .uncertain:
            VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
                VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                    Label {
                        Text(verbatim: l10n.string(.commitmentsIosUncertainTitle))
                            .font(Theme.Typography.rowTitle.font)
                            .foregroundStyle(ThemeColor.text.color)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(StatusTone.warning.foreground.color)
                    }
                    Text(verbatim: l10n.string(.commitmentsIosUncertainWrite))
                        .font(Theme.Typography.meta.font)
                        .foregroundStyle(ThemeColor.text.color)
                    if let code = model.retryConflictCode {
                        if let key = RecurringPresenter.retryConflictKey(code) {
                            Text(verbatim: l10n.string(key))
                                .font(Theme.Typography.meta.font)
                                .foregroundStyle(ThemeColor.text.color)
                        }
                        Text(verbatim: l10n.string(.commitmentsIosRetryConflictNote))
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
                    Text(verbatim: l10n.string(.commitmentsIosCheck)).frame(maxWidth: .infinity)
                }
                .buttonStyle(OrdoSecondaryButtonStyle())
                .disabled(model.isChecking)
            }
        case .idle:
            EmptyView()
        }
    }
}

/// The End confirmation, attached once per visible screen. It acts on the recurring expense it presents.
struct RecurringDialogs: ViewModifier {
    let model: RecurringViewModel
    let l10n: L10n
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .confirmationDialog(model.endTarget.map { l10n.string(.commitmentsSavedEndPrompt, $0.name) } ?? "",
                                isPresented: Binding(get: { isActive && model.endTarget != nil },
                                                     set: { if !$0 { model.cancelEnd() } }),
                                titleVisibility: .visible, presenting: model.endTarget) { commitment in
                Button(l10n.string(.commitmentsSavedConfirmEnd), role: .destructive) { model.confirmEnd(commitment) }
                Button(l10n.string(.commitmentsSavedCancelEnd), role: .cancel) { model.cancelEnd() }
            }
            .confirmationDialog(model.changeEndTarget.map { l10n.string(.commitmentsChangesMarkEndedPrompt, $0.name) } ?? "",
                                isPresented: Binding(get: { isActive && model.changeEndTarget != nil },
                                                     set: { if !$0 { model.cancelChangeEnd() } }),
                                titleVisibility: .visible, presenting: model.changeEndTarget) { target in
                Button(l10n.string(.commitmentsChangesConfirmMarkEnded), role: .destructive) { model.confirmChangeEnd(target) }
                Button(l10n.string(.commitmentsChangesCancelMarkEnded), role: .cancel) { model.cancelChangeEnd() }
            }
    }
}

/// One matching expense: description, date and category, source and the exact amount.
struct CommitmentEvidenceRow: View {
    let evidence: CommitmentEvidence
    let presenter: RecurringPresenter

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: evidence.text)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: presenter.money(evidence.amount))
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
            Group {
                Text(verbatim: "\(presenter.date(evidence.date)) · \(presenter.category(evidence.category))")
                Text(verbatim: presenter.source(evidence.source))
            }
            .font(Theme.Typography.meta.font)
            .foregroundStyle(ThemeColor.textMuted.color)
        }
        .accessibilityElement(children: .combine)
    }
}
