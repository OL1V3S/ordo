import Foundation

/// Labels for the change review, ported from the web's `CommitmentChangeReview.jsx`. Saved and
/// observed money is shown as the server reported it and is never totalled or shown as spent.
extension RecurringPresenter {
    func dimensionTitle(_ dimension: ChangeDimension) -> String {
        switch dimension {
        case .amount: l10n.string(.commitmentsChangesDimensionAmount)
        case .timing: l10n.string(.commitmentsChangesDimensionTiming)
        case .missing: l10n.string(.commitmentsChangesDimensionMissing)
        }
    }

    func decisionStatus(_ state: ChangeDecisionState) -> String {
        l10n.string(state == .kept ? .commitmentsChangesStatusKept : .commitmentsChangesStatusPending)
    }

    /// "3 recent expenses support this amount change." or the missing-date sentence for the cadence.
    func explanation(_ assessment: ChangeAssessment, cadence: String) -> String {
        switch assessment.proposal {
        case .missing(_, let dates):
            let count = String(dates.count)
            let one = dates.count == 1
            let key: L10nKey = switch cadence {
            case "weekly": one ? .commitmentsChangesExplanationMissingWeeklyOne : .commitmentsChangesExplanationMissingWeeklyOther
            case "monthly": one ? .commitmentsChangesExplanationMissingMonthlyOne : .commitmentsChangesExplanationMissingMonthlyOther
            case "yearly": one ? .commitmentsChangesExplanationMissingYearlyOne : .commitmentsChangesExplanationMissingYearlyOther
            default: one ? .commitmentsChangesExplanationMissingOtherOne : .commitmentsChangesExplanationMissingOtherOther
            }
            return l10n.string(key, count)
        case .amount:
            let one = assessment.evidence.count == 1
            return l10n.string(one ? .commitmentsChangesExplanationAmountOne : .commitmentsChangesExplanationAmountOther,
                               String(assessment.evidence.count))
        case .timing:
            let one = assessment.evidence.count == 1
            return l10n.string(one ? .commitmentsChangesExplanationTimingOne : .commitmentsChangesExplanationTimingOther,
                               String(assessment.evidence.count))
        }
    }

    /// The saved value for an amount or timing change.
    func savedValue(_ assessment: ChangeAssessment, commitment: ChangeCommitment) -> String? {
        switch assessment.proposal {
        case .amount: amount(commitment.amount)
        case .timing: timingSummary(commitment.timing)
        case .missing: nil
        }
    }

    /// The observed value for an amount or timing change.
    func proposedValue(_ assessment: ChangeAssessment) -> String? {
        switch assessment.proposal {
        case .amount(let proposed): amount(proposed)
        case .timing(let timing): timingSummary(timing)
        case .missing: nil
        }
    }

    func missingState(_ state: MissingState) -> String {
        l10n.string(state == .possiblyEnded ? .commitmentsChangesPossiblyEnded : .commitmentsChangesNotSeen)
    }

    func decisionTitle(_ decision: ChangeDecision, dimension: ChangeDimension) -> String {
        switch decision {
        case .accept: l10n.string(.commitmentsChangesAccept)
        case .keep: l10n.string(dimension == .missing ? .commitmentsChangesKeepActive : .commitmentsChangesKeepCurrent)
        case .markEnded: l10n.string(.commitmentsChangesMarkEnded)
        case .reconsider: l10n.string(.commitmentsChangesReconsider)
        }
    }

    func decisionLabel(_ decision: ChangeDecision, dimension: ChangeDimension, name: String) -> String {
        switch (decision, dimension) {
        case (.accept, .timing): l10n.string(.commitmentsChangesAcceptLabelTiming, name)
        case (.accept, _): l10n.string(.commitmentsChangesAcceptLabelAmount, name)
        case (.keep, .amount): l10n.string(.commitmentsChangesKeepCurrentLabelAmount, name)
        case (.keep, .timing): l10n.string(.commitmentsChangesKeepCurrentLabelTiming, name)
        case (.keep, .missing): l10n.string(.commitmentsChangesKeepCurrentLabelMissing, name)
        case (.markEnded, _): l10n.string(.commitmentsChangesMarkEndedLabel, name)
        case (.reconsider, .amount): l10n.string(.commitmentsChangesReconsiderLabelAmount, name)
        case (.reconsider, .timing): l10n.string(.commitmentsChangesReconsiderLabelTiming, name)
        case (.reconsider, .missing): l10n.string(.commitmentsChangesReconsiderLabelMissing, name)
        }
    }

    func changesLink(_ count: Int) -> String {
        l10n.string(count == 1 ? .commitmentsPageChangesLinkOne : .commitmentsPageChangesLinkOther, String(count))
    }

    func changeHeading(_ count: Int) -> String { "\(l10n.string(.commitmentsChangesHeading)) · \(count)" }

    /// One spoken summary of a change row.
    func accessibilitySummary(_ change: CommitmentChange) -> String {
        var parts = [change.commitment.name,
                     categoryAndCadence(category: change.commitment.category, cadence: change.commitment.timing.cadence)]
        parts += change.assessments.map { "\(dimensionTitle($0.dimension)), \(decisionStatus($0.decision))" }
        return parts.joined(separator: ". ")
    }

    /// The retry-conflict line, or nil when the server's code must not be shown yet: a stale proposal
    /// is only "updated, we loaded the latest" after Check has actually read it again.
    static func retryConflictKey(_ code: String) -> L10nKey? {
        code == "change_proposal_changed" ? nil : errorKey(code)
    }
}
