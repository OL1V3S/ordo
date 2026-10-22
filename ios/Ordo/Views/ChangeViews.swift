import SwiftUI

/// A change row: the recurring expense and which of its details changed. Decisions are made on the
/// detail screen only.
struct ChangeRow: View {
    let change: CommitmentChange
    let presenter: RecurringPresenter

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
            Text(verbatim: change.commitment.name)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            Text(verbatim: presenter.categoryAndCadence(category: change.commitment.category, cadence: change.commitment.timing.cadence))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
            ForEach(change.assessments) { assessment in
                Text(verbatim: "\(presenter.dimensionTitle(assessment.dimension)) · \(presenter.decisionStatus(assessment.decision))")
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presenter.accessibilitySummary(change)))
    }
}

/// One recurring expense's changes: saved details against the observed change, the expenses behind
/// it, missed dates, why it was suggested, and the decisions. Everything is what the server last
/// reported; a decision reads the lists and Home again.
struct ChangeDetailView: View {
    let model: RecurringViewModel
    let commitmentId: String
    let presenter: RecurringPresenter

    private var l10n: L10n { presenter.l10n }

    var body: some View {
        List {
            if let change = model.change(id: commitmentId) {
                content(change)
            } else {
                Section {
                    status
                    InlineStatusView(systemImage: "info.circle", message: l10n.string(.commitmentsChangesEmptyPending), tone: .info)
                }
                .themedRows()
            }
        }
        .themedList()
        .themedCanvas()
        .navigationTitle(model.change(id: commitmentId)?.commitment.name ?? l10n.string(.commitmentsChangesHeading))
        .navigationBarTitleDisplayMode(.inline)
        .modifier(RecurringDialogs(model: model, l10n: l10n, isActive: true))
    }

    @ViewBuilder private var status: some View {
        if model.writePhase != .idle && !model.isSheetPresented { RecurringStatusContent(model: model, l10n: l10n) }
        if let notice = model.notice {
            StatusBanner(tone: RecurringPresenter.noticeTone(notice), systemImage: RecurringPresenter.noticeIcon(notice),
                         message: l10n.string(RecurringPresenter.noticeKey(notice)))
        }
    }

    @ViewBuilder private func content(_ change: CommitmentChange) -> some View {
        Section {
            status
            Text(verbatim: presenter.categoryAndCadence(category: change.commitment.category,
                                                        cadence: change.commitment.timing.cadence))
                .font(Theme.Typography.meta.font)
                .foregroundStyle(ThemeColor.textMuted.color)
        }
        .themedRows()

        ForEach(change.assessments) { assessment in
            assessmentSections(assessment, change: change)
        }

        Section {
            fact(.commitmentsChangesEvaluated, presenter.date(model.changes?.evaluatedOn))
            fact(.commitmentsChangesDetectionDetails, change.algorithmVersion)
        }
        .themedRows()
    }

    @ViewBuilder private func assessmentSections(_ assessment: ChangeAssessment, change: CommitmentChange) -> some View {
        Section {
            Text(verbatim: presenter.explanation(assessment, cadence: change.commitment.timing.cadence))
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
            switch assessment.proposal {
            case .missing(let state, let dates):
                Text(verbatim: presenter.missingState(state))
                    .font(Theme.Typography.body.font)
                    .foregroundStyle(ThemeColor.text.color)
                Text(verbatim: l10n.string(.commitmentsChangesObservationNote))
                    .font(Theme.Typography.meta.font)
                    .foregroundStyle(ThemeColor.textMuted.color)
                ForEach(Array(dates.enumerated()), id: \.offset) { _, date in
                    Text(verbatim: presenter.date(date))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.text.color)
                }
            case .amount, .timing:
                if let saved = presenter.savedValue(assessment, commitment: change.commitment) {
                    fact(.commitmentsChangesCurrentExpectation, saved)
                }
                if let proposed = presenter.proposedValue(assessment) { fact(.commitmentsChangesObservedChange, proposed) }
            }
            if !assessment.isExact {
                InlineStatusView(systemImage: "exclamationmark.triangle", message: l10n.string(.commitmentsIosExactUnavailable),
                                 tone: .warning)
            }
            actions(assessment, change: change)
        } header: {
            Text(verbatim: "\(presenter.dimensionTitle(assessment.dimension)) · \(presenter.decisionStatus(assessment.decision))")
                .themedSectionHeader().accessibilityAddTraits(.isHeader)
        }
        .themedRows()

        if !assessment.evidence.isEmpty {
            Section {
                ForEach(assessment.evidence) { CommitmentEvidenceRow(evidence: $0, presenter: presenter) }
            } header: {
                Text(verbatim: l10n.string(.commitmentsChangesDetails)).themedSectionHeader().accessibilityAddTraits(.isHeader)
            }
            .themedRows()
        }
    }

    @ViewBuilder private func actions(_ assessment: ChangeAssessment, change: CommitmentChange) -> some View {
        let enabled = model.canDecideChanges && assessment.isActionable
        ForEach(assessment.decisions, id: \.self) { decision in
            Button {
                model.decide(decision, commitmentId: change.commitment.id, assessmentId: assessment.id)
            } label: {
                Text(verbatim: presenter.decisionTitle(decision, dimension: assessment.dimension)).frame(maxWidth: .infinity)
            }
            .buttonStyle(ChangeButtonStyle(decision: decision, isFirst: decision == assessment.decisions.first))
            .disabled(!enabled)
            .accessibilityLabel(Text(verbatim: presenter.decisionLabel(decision, dimension: assessment.dimension,
                                                                       name: change.commitment.name)))
        }
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

/// Mark as ended is destructive; the first decision is the primary one.
struct ChangeButtonStyle: ButtonStyle {
    let decision: ChangeDecision
    let isFirst: Bool

    func makeBody(configuration: Configuration) -> some View {
        switch (decision, isFirst) {
        case (.markEnded, _): OrdoDestructiveButtonStyle().makeBody(configuration: configuration)
        case (_, true): OrdoPrimaryButtonStyle().makeBody(configuration: configuration)
        default: OrdoSecondaryButtonStyle().makeBody(configuration: configuration)
        }
    }
}
