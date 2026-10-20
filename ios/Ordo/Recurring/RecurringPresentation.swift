import Foundation

/// Labels and formatting for the Recurring expenses screen, ported from the web's
/// `formatCommitments.js` and `CommitmentsPage.jsx`. Money is shown exactly as the server reported it;
/// expected and observed money is never shown as recorded spending and nothing is ever totalled.
struct RecurringPresenter {
    let l10n: L10n
    private var formatter: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: "USD") }

    func date(_ value: CalendarDate?) -> String {
        guard let value else { return l10n.string(.commitmentsFormatUnknownDate) }
        return DateFormatting.string(value, language: l10n.language)
    }

    func money(_ value: CommitmentMoney) -> String {
        switch value {
        case .exact(let money): formatter.string(money)
        case .needsReview: l10n.string(.commitmentsFormatAmountUnavailable)
        }
    }

    func amount(_ value: CommitmentAmount) -> String {
        switch value {
        case .fixed(let money): self.money(money)
        case .range(let minimum, let maximum): "\(self.money(minimum))–\(self.money(maximum))"
        case .unavailable: l10n.string(.commitmentsFormatAmountUnavailable)
        }
    }

    /// The observed amount of a possible recurring expense: the middle amount when every expense was
    /// the same, otherwise the minimum to the maximum.
    func observedAmount(_ candidate: RecurringCandidate) -> String {
        candidate.observedFixed ? money(candidate.median) : "\(money(candidate.minimum))–\(money(candidate.maximum))"
    }

    /// The web's `title()`: unknown wire values are shown capitalized with underscores as spaces.
    static func title(_ value: String) -> String {
        let spaced = value.replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
        return spaced.prefix(1).uppercased() + spaced.dropFirst()
    }

    func cadence(_ value: String) -> String {
        switch value {
        case "weekly": l10n.string(.commitmentsCadenceWeekly)
        case "monthly": l10n.string(.commitmentsCadenceMonthly)
        case "yearly": l10n.string(.commitmentsCadenceYearly)
        default: Self.title(value)
        }
    }

    func weekday(_ value: String?) -> String {
        let key: L10nKey? = switch value?.lowercased() {
        case "sunday": .commitmentsWeekdaySunday
        case "monday": .commitmentsWeekdayMonday
        case "tuesday": .commitmentsWeekdayTuesday
        case "wednesday": .commitmentsWeekdayWednesday
        case "thursday": .commitmentsWeekdayThursday
        case "friday": .commitmentsWeekdayFriday
        case "saturday": .commitmentsWeekdaySaturday
        default: nil
        }
        return key.map { l10n.string($0) } ?? Self.title(value ?? "")
    }

    func lifecycle(_ value: CommitmentLifecycle) -> String {
        switch value {
        case .active: l10n.string(.commitmentsLifecycleActive)
        case .paused: l10n.string(.commitmentsLifecyclePaused)
        case .ended: l10n.string(.commitmentsLifecycleEnded)
        }
    }

    func groupHeading(_ group: RecurringViewModel.Group) -> String {
        switch group {
        case .paused: l10n.string(.commitmentsHistoryPaused)
        case .ended: l10n.string(.commitmentsHistoryEnded)
        case .dismissed: l10n.string(.commitmentsHistoryDismissedHeading)
        }
    }

    func category(_ value: String) -> String { CategoryLabel.label(for: value, l10n: l10n) }

    func categoryAndCadence(category value: String, cadence cadenceValue: String) -> String {
        "\(category(value)) · \(cadence(cadenceValue))"
    }

    /// "Day 15, up to 1 day early or 2 days late" (the web's `timingSummary`). The server has no
    /// next-date projection for recurring expenses, so none is computed here.
    func timingSummary(_ timing: CommitmentTiming) -> String {
        func days(_ count: Int?, before: Bool) -> String {
            let value = count ?? 0
            let one: L10nKey = before ? .commitmentsTimingSummaryBeforeOne : .commitmentsTimingSummaryAfterOne
            let other: L10nKey = before ? .commitmentsTimingSummaryBeforeOther : .commitmentsTimingSummaryAfterOther
            return l10n.string(value == 1 ? one : other, String(value))
        }
        let before = days(timing.windowBeforeDays, before: true)
        let after = days(timing.windowAfterDays, before: false)
        func number(_ value: Int?) -> String { value.map(String.init) ?? "?" }
        if timing.cadence == "weekly" { return l10n.string(.commitmentsTimingSummaryWeekly, weekday(timing.dayOfWeek), before, after) }
        if timing.cadence == "monthly", timing.kind == "monthend" { return l10n.string(.commitmentsTimingSummaryMonthEnd, before, after) }
        if timing.cadence == "yearly" {
            return l10n.string(.commitmentsTimingSummaryYearly, number(timing.month), number(timing.day), before, after)
        }
        return l10n.string(.commitmentsTimingSummaryDayOfMonth, number(timing.day), before, after)
    }

    func evidenceRule(_ value: String) -> String {
        switch value {
        case "consecutive_calendar_months": l10n.string(.commitmentsEvidenceRulesConsecutiveCalendarMonths)
        case "weekly_six_to_eight_day_gaps": l10n.string(.commitmentsEvidenceRulesWeeklySixToEightDayGaps)
        case "consecutive_years_same_month": l10n.string(.commitmentsEvidenceRulesConsecutiveYearsSameMonth)
        default: Self.title(value)
        }
    }

    func source(_ value: String) -> String {
        value == "sunflower_pdf" ? l10n.string(.commitmentsEvidenceSourcesSunflowerPdf) : l10n.string(.commitmentsEvidenceSourcesManual)
    }

    func linkedExpenses(_ count: Int) -> String {
        l10n.string(count == 1 ? .commitmentsSavedLinkedExpensesOne : .commitmentsSavedLinkedExpensesOther, String(count))
    }

    func basedOn(_ candidate: RecurringCandidate) -> String {
        let count = String(candidate.occurrenceCount)
        let one = candidate.occurrenceCount == 1
        if candidate.observedFixed {
            return l10n.string(one ? .commitmentsCandidatesBasedOnFixedOne : .commitmentsCandidatesBasedOnFixedOther, count)
        }
        return l10n.string(one ? .commitmentsCandidatesBasedOnRangeOne : .commitmentsCandidatesBasedOnRangeOther, count)
    }

    func evidenceSummary(_ candidate: RecurringCandidate) -> String {
        l10n.string(candidate.occurrenceCount == 1 ? .commitmentsCandidatesEvidenceSummaryOne : .commitmentsCandidatesEvidenceSummaryOther,
                    String(candidate.occurrenceCount), evidenceRule(candidate.evidenceRule))
    }

    func coveredPeriod(_ candidate: RecurringCandidate) -> String {
        "\(date(candidate.coveredFrom))–\(date(candidate.coveredTo))"
    }

    func observedAmountDetail(_ candidate: RecurringCandidate) -> String {
        candidate.observedFixed ? l10n.string(.commitmentsCandidatesIdentical)
            : l10n.string(.commitmentsCandidatesMedian, money(candidate.median))
    }

    func actionTitle(_ action: RecurringViewModel.LifecycleAction) -> String {
        switch action {
        case .pause: l10n.string(.commitmentsSavedPause)
        case .reactivate: l10n.string(.commitmentsSavedReactivate)
        case .end: l10n.string(.commitmentsSavedEnd)
        }
    }

    func actionLabel(_ action: RecurringViewModel.LifecycleAction, name: String) -> String {
        switch action {
        case .pause: l10n.string(.commitmentsSavedPauseLabel, name)
        case .reactivate: l10n.string(.commitmentsSavedReactivateLabel, name)
        case .end: l10n.string(.commitmentsSavedEndLabel, name)
        }
    }

    static func fieldErrorKey(_ field: ConfirmField) -> L10nKey {
        switch field {
        case .name: .commitmentsFeedbackErrorsNameInvalid
        case .category: .commitmentsFeedbackErrorsCategoryInvalid
        case .timing: .commitmentsFeedbackErrorsTimingInvalid
        case .amount: .commitmentsFeedbackErrorsAmountInvalid
        }
    }

    /// A server `code` to its message; anything unknown is the generic one.
    static func errorKey(_ code: String?) -> L10nKey {
        switch code {
        case "candidate_changed": .commitmentsFeedbackErrorsCandidateChanged
        case "candidate_dismissed": .commitmentsFeedbackErrorsCandidateDismissed
        case "confirmation_conflict": .commitmentsFeedbackErrorsConfirmationConflict
        case "fingerprint_invalid": .commitmentsFeedbackErrorsFingerprintInvalid
        case "name_invalid": .commitmentsFeedbackErrorsNameInvalid
        case "category_invalid": .commitmentsFeedbackErrorsCategoryInvalid
        case "cadence_invalid": .commitmentsFeedbackErrorsCadenceInvalid
        case "timing_invalid": .commitmentsFeedbackErrorsTimingInvalid
        case "amount_invalid": .commitmentsFeedbackErrorsAmountInvalid
        case "lifecycle_invalid": .commitmentsFeedbackErrorsLifecycleInvalid
        case "commitment_not_found": .commitmentsFeedbackErrorsCommitmentNotFound
        default: .commitmentsFeedbackErrorsRequestFailed
        }
    }

    static func noticeKey(_ notice: RecurringViewModel.Notice) -> L10nKey {
        switch notice {
        case .confirmed: .commitmentsFeedbackNoticesConfirmed
        case .dismissed: .commitmentsFeedbackNoticesDismissed
        case .reconsidered: .commitmentsFeedbackNoticesReconsidered
        case .lifecycle: .commitmentsFeedbackNoticesLifecycle
        case .checked: .commitmentsIosCheckedNotice
        case .refreshFailedAfterWrite: .commitmentsIosRefreshFailedAfterWrite
        case .error(let code): errorKey(code)
        }
    }

    static func noticeTone(_ notice: RecurringViewModel.Notice) -> StatusTone {
        switch notice {
        case .confirmed, .dismissed, .reconsidered, .lifecycle: .success
        case .checked, .refreshFailedAfterWrite: .warning
        case .error: .danger
        }
    }

    static func noticeIcon(_ notice: RecurringViewModel.Notice) -> String {
        switch notice {
        case .confirmed, .dismissed, .reconsidered, .lifecycle: "checkmark.circle"
        case .checked, .refreshFailedAfterWrite, .error: "exclamationmark.triangle"
        }
    }

    /// One spoken summary of a confirmed recurring expense row.
    func accessibilitySummary(_ commitment: RecurringCommitment) -> String {
        [commitment.name, lifecycle(commitment.lifecycle),
         categoryAndCadence(category: commitment.category, cadence: commitment.timing.cadence),
         timingSummary(commitment.timing),
         "\(l10n.string(.commitmentsSavedExpectedAmount)): \(amount(commitment.amount))"].joined(separator: ". ")
    }

    /// One spoken summary of a possible recurring expense row.
    func accessibilitySummary(_ candidate: RecurringCandidate, dismissed: Bool) -> String {
        var parts = [candidate.name, categoryAndCadence(category: candidate.category, cadence: candidate.timing.cadence),
                     basedOn(candidate),
                     "\(l10n.string(candidate.observedFixed ? .commitmentsCandidatesObservedAmount : .commitmentsCandidatesObservedAmountRange)): \(observedAmount(candidate))"]
        if dismissed { parts.insert(l10n.string(.commitmentsCandidatesDismissedStatus), at: 1) }
        return parts.joined(separator: ". ")
    }
}
