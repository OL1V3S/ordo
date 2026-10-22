import SwiftUI

/// One recurring expense (its facts and matching expenses) or one possible recurring expense (what
/// the server observed). A confirmed one offers the same actions as the list.
struct RecurringDetailView: View {
    let model: RecurringViewModel
    let route: RecurringRoute
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        List {
            switch route {
            case .commitment(let id):
                if let commitment = model.commitment(id: id) { commitmentContent(commitment) } else { gone }
            case .candidate(let fingerprint):
                if let candidate = model.candidate(fingerprint: fingerprint) { candidateContent(candidate) } else { gone }
            case .change:
                gone
            }
        }
        .themedList()
        .themedCanvas()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .modifier(RecurringDialogs(model: model, l10n: l10n, isActive: true))
    }

    private var title: String {
        switch route {
        case .commitment(let id): model.commitment(id: id)?.name ?? l10n.string(.commitmentsPageTitle)
        case .candidate(let fingerprint): model.candidate(fingerprint: fingerprint)?.name ?? l10n.string(.commitmentsPageTitle)
        case .change: l10n.string(.commitmentsPageTitle)
        }
    }

    private var gone: some View {
        Section {
            InlineStatusView(systemImage: "exclamationmark.triangle",
                             message: l10n.string(.commitmentsFeedbackErrorsCommitmentNotFound), tone: .warning)
        }
        .themedRows()
    }

    @ViewBuilder private func status() -> some View {
        if model.writePhase != .idle && !model.isSheetPresented { RecurringStatusContent(model: model, l10n: l10n) }
        if let notice = model.notice {
            StatusBanner(tone: RecurringPresenter.noticeTone(notice), systemImage: RecurringPresenter.noticeIcon(notice),
                         message: l10n.string(RecurringPresenter.noticeKey(notice)))
        }
    }

    @ViewBuilder private func commitmentContent(_ commitment: RecurringCommitment) -> some View {
        Section {
            status()
            CommitmentActionsRow(commitment: commitment, model: model, presenter: presenter)
        }
        .themedRows()

        Section {
            fact(.commitmentsFormName, commitment.name)
            fact(.commitmentsFormCategory, presenter.category(commitment.category))
            fact(.commitmentsFormCadence, presenter.cadence(commitment.timing.cadence))
            Text(verbatim: presenter.lifecycle(commitment.lifecycle))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: presenter.timingSummary(commitment.timing))
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
            fact(.commitmentsSavedExpectedAmount, presenter.amount(commitment.amount))
        }
        .themedRows()

        Section {
            evidenceList(commitment.evidence)
        } header: {
            Text(verbatim: "\(l10n.string(.commitmentsSavedRecordsUsed)) · \(presenter.linkedExpenses(commitment.evidence.count))")
                .themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private func candidateContent(_ candidate: RecurringCandidate) -> some View {
        let dismissed = model.snapshot?.dismissed.contains { $0.fingerprint == candidate.fingerprint } == true
        Section {
            status()
            CandidateActionsRow(candidate: candidate, dismissed: dismissed, model: model, presenter: presenter)
        }
        .themedRows()

        Section {
            fact(.commitmentsCandidatesEvidence, presenter.evidenceSummary(candidate))
            fact(.commitmentsCandidatesCoveredPeriod, presenter.coveredPeriod(candidate))
            fact(.commitmentsCandidatesObservedTiming, presenter.timingSummary(candidate.timing))
            fact(candidate.observedFixed ? .commitmentsCandidatesObservedAmount : .commitmentsCandidatesObservedAmountRange,
                 "\(presenter.observedAmount(candidate)) · \(presenter.observedAmountDetail(candidate))")
        }
        .themedRows()

        Section {
            evidenceList(candidate.evidence)
        } header: {
            Text(verbatim: l10n.string(.commitmentsCandidatesEvidence)).themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()
    }

    @ViewBuilder private func evidenceList(_ rows: [CommitmentEvidence]) -> some View {
        ForEach(rows) { CommitmentEvidenceRow(evidence: $0, presenter: presenter) }
    }

    private func fact(_ key: L10nKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: l10n.string(key))
                .font(Theme.Typography.fieldCaption.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            Text(verbatim: value)
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
        }
        .accessibilityElement(children: .combine)
    }
}
