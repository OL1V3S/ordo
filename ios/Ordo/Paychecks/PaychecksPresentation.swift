import Foundation

/// Labels and formatting for the Paychecks screen, ported from the web's `formatPaychecks.js`.
/// Money is shown exactly as the server reported it; expected money is never shown as received.
struct PaychecksPresenter {
    let l10n: L10n
    private var formatter: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: "USD") }

    func date(_ value: CalendarDate?) -> String {
        guard let value else { return l10n.string(.paychecksFormatUnknownDate) }
        return DateFormatting.string(value, language: l10n.language)
    }

    func money(_ value: PaycheckMoney) -> String {
        switch value {
        case .exact(let money): formatter.string(money)
        case .needsReview: l10n.string(.paychecksFormatAmountNeedsReview)
        }
    }

    func amount(_ value: PaycheckAmount) -> String {
        switch value {
        case .fixed(let money): self.money(money)
        case .range(let minimum, let maximum): "\(self.money(minimum)) – \(self.money(maximum))"
        case .unavailable: l10n.string(.paychecksFormatAmountUnavailable)
        }
    }

    func lifecycle(_ value: PaycheckLifecycle) -> String {
        switch value {
        case .active: l10n.string(.paychecksLifecycleActive)
        case .paused: l10n.string(.paychecksLifecyclePaused)
        case .ended: l10n.string(.paychecksLifecycleEnded)
        }
    }

    func groupHeading(_ value: PaycheckLifecycle) -> String {
        switch value {
        case .active: l10n.string(.paychecksGroupsActive)
        case .paused: l10n.string(.paychecksGroupsPaused)
        case .ended: l10n.string(.paychecksGroupsEnded)
        }
    }

    func cadence(_ value: PaycheckCadence) -> String {
        switch value {
        case .weekly: l10n.string(.paychecksCadenceWeekly)
        case .biweekly: l10n.string(.paychecksCadenceBiweekly)
        case .semimonthly: l10n.string(.paychecksCadenceSemimonthly)
        case .monthly: l10n.string(.paychecksCadenceMonthly)
        case .unknown: l10n.string(.paychecksCadenceUnknown)
        }
    }

    func cadence(of profile: PaycheckProfile) -> String { cadence(profile.schedule?.cadence ?? .unknown) }

    private func anchor(_ value: MonthAnchor?) -> String {
        switch value {
        case .monthEnd?: l10n.string(.paychecksFormatMonthEnd)
        case .day(let day)?: l10n.string(.paychecksFormatDayOfMonth, String(day))
        default: l10n.string(.paychecksFormatDayOfMonth, "?")
        }
    }

    func schedule(_ value: PaycheckSchedule?) -> String {
        guard let value else { return l10n.string(.paychecksFormatScheduleUnavailable) }
        let label = cadence(value.cadence)
        switch value.cadence {
        case .weekly, .biweekly: return l10n.string(.paychecksFormatScheduleReference, label, date(value.reference))
        case .semimonthly: return l10n.string(.paychecksFormatScheduleSemimonthly, label, anchor(value.first), anchor(value.second))
        case .monthly: return l10n.string(.paychecksFormatScheduleMonthly, label, anchor(value.first))
        case .unknown: return l10n.string(.paychecksFormatScheduleUnavailable)
        }
    }

    func window(before: Int?, after: Int?) -> String {
        guard let before, let after else { return l10n.string(.paychecksFormatScheduleUnavailable) }
        let beforeText = l10n.string(before == 1 ? .paychecksFormatDaysBeforeOne : .paychecksFormatDaysBeforeOther, String(before))
        let afterText = l10n.string(after == 1 ? .paychecksFormatDaysAfterOne : .paychecksFormatDaysAfterOther, String(after))
        return l10n.string(.paychecksFormatWindow, beforeText, afterText)
    }

    /// `earliest–latest`, or a single date when they are equal.
    func range(_ earliest: CalendarDate?, _ latest: CalendarDate?) -> String {
        guard let earliest, let latest else { return l10n.string(.paychecksFormatUnknownDate) }
        return earliest == latest ? date(earliest) : "\(date(earliest))–\(date(latest))"
    }

    /// The next expected window, or why there is none.
    func nextWindow(_ profile: PaycheckProfile) -> String {
        switch profile.lifecycle {
        case .paused: return l10n.string(.paychecksCardNoWindowPaused)
        case .ended: return l10n.string(.paychecksCardNoWindowEnded)
        case .active:
            guard let projection = profile.projection else { return l10n.string(.paychecksCardNoWindowActive) }
            return range(projection.earliest, projection.latest)
        }
    }

    func slotLabel(_ slot: PaycheckSlot, stale: Bool = false) -> String {
        let key: L10nKey = switch (slot.relation, stale) {
        case (.current, false): .paychecksReceiptSlotCurrent
        case (.current, true): .paychecksReceiptSlotCurrentStale
        case (.previous, false): .paychecksReceiptSlotPrevious
        case (.previous, true): .paychecksReceiptSlotPreviousStale
        }
        return l10n.string(key, date(slot.earliest), date(slot.latest))
    }

    func linkedCount(_ profile: PaycheckProfile) -> String { String(profile.evidence.count) }

    func evidenceTiming(_ evidence: PaycheckEvidence) -> String {
        let timing: String
        if let offset = evidence.timingOffsetDays {
            if offset == 0 { timing = l10n.string(.paychecksEvidenceOnScheduleDate) }
            else if offset < 0 { timing = l10n.string(.paychecksEvidenceDaysBefore, String(-offset)) }
            else { timing = l10n.string(.paychecksEvidenceDaysAfter, String(offset)) }
        } else {
            timing = l10n.string(.paychecksFormatUnknownDate)
        }
        return l10n.string(.paychecksEvidenceScheduleTiming, date(evidence.slotAnchor), timing)
    }

    func actionTitle(_ action: PaychecksViewModel.LifecycleAction) -> String {
        switch action {
        case .pause: l10n.string(.paychecksActionsPause)
        case .reactivate: l10n.string(.paychecksActionsReactivate)
        case .end: l10n.string(.paychecksActionsEnd)
        }
    }

    func actionLabel(_ action: PaychecksViewModel.LifecycleAction, name: String) -> String {
        switch action {
        case .pause: l10n.string(.paychecksActionsPauseLabel, name)
        case .reactivate: l10n.string(.paychecksActionsReactivateLabel, name)
        case .end: l10n.string(.paychecksActionsEndLabel, name)
        }
    }

    func warning(_ value: ReceiptWarning) -> String {
        let key: L10nKey = switch value {
        case .dateOutsideWindow: .paychecksReceiptWarningsDateOutsideWindow
        case .amountNeedsReview: .paychecksReceiptWarningsAmountNeedsReview
        case .expectedAmountNeedsReview: .paychecksReceiptWarningsExpectedAmountNeedsReview
        case .differsFromFixed: .paychecksReceiptWarningsDiffersFromFixed
        case .expectedRangeNeedsReview: .paychecksReceiptWarningsExpectedRangeNeedsReview
        case .outsideRange: .paychecksReceiptWarningsOutsideRange
        }
        return l10n.string(key)
    }

    static func fieldErrorKey(_ field: ReceiptField) -> L10nKey {
        switch field {
        case .description: .paychecksReceiptCashInErrorsDescriptionRequired
        case .amount: .paychecksReceiptCashInErrorsAmount
        case .date: .paychecksReceiptCashInErrorsDate
        }
    }

    /// A server `code` to its message; anything unknown is the generic one.
    static func errorKey(_ code: String?) -> L10nKey {
        switch code {
        case "authentication_required": .paychecksFeedbackErrorsAuthenticationRequired
        case "paycheck_not_found": .paychecksFeedbackErrorsPaycheckNotFound
        case "lifecycle_invalid": .paychecksFeedbackErrorsLifecycleInvalid
        case "schedule_invalid": .paychecksFeedbackErrorsScheduleInvalid
        case "paycheck_not_active": .paychecksFeedbackErrorsPaycheckNotActive
        case "receipt_slot_invalid": .paychecksFeedbackErrorsReceiptSlotInvalid
        case "receipt_slot_unavailable": .paychecksFeedbackErrorsReceiptSlotUnavailable
        case "receipt_source_invalid": .paychecksFeedbackErrorsReceiptSourceInvalid
        case "receipt_inflow_invalid": .paychecksFeedbackErrorsReceiptInflowInvalid
        case "receipt_inflow_unavailable": .paychecksFeedbackErrorsReceiptInflowUnavailable
        case "receipt_conflict": .paychecksFeedbackErrorsReceiptConflict
        case "receipt_link_protected": .paychecksFeedbackErrorsReceiptLinkProtected
        case "receipt_date_invalid": .paychecksFeedbackErrorsReceiptDateInvalid
        case "request_invalid": .paychecksFeedbackErrorsRequestInvalid
        default: .paychecksFeedbackErrorsRequestFailed
        }
    }

    static func noticeKey(_ notice: PaychecksViewModel.Notice) -> L10nKey {
        switch notice {
        case .lifecycle: .paychecksFeedbackNoticesLifecycle
        case .receiptRecorded: .paychecksFeedbackNoticesReceiptRecorded
        case .receiptRemoved: .paychecksFeedbackNoticesReceiptRemoved
        case .checked: .paychecksIosCheckedNotice
        case .receiptChecked: .paychecksFeedbackUncertainReceiptLoaded
        case .refreshFailedAfterWrite: .paychecksIosRefreshFailedAfterWrite
        case .error(let code): errorKey(code)
        }
    }

    static func noticeTone(_ notice: PaychecksViewModel.Notice) -> StatusTone {
        switch notice {
        case .lifecycle, .receiptRecorded, .receiptRemoved: .success
        case .checked, .receiptChecked, .refreshFailedAfterWrite: .warning
        case .error: .danger
        }
    }

    static func noticeIcon(_ notice: PaychecksViewModel.Notice) -> String {
        switch notice {
        case .lifecycle, .receiptRecorded, .receiptRemoved: "checkmark.circle"
        case .checked, .receiptChecked, .refreshFailedAfterWrite, .error: "exclamationmark.triangle"
        }
    }

    /// One spoken summary of a row.
    func accessibilitySummary(_ profile: PaycheckProfile) -> String {
        [profile.name, lifecycle(profile.lifecycle), cadence(of: profile), amount(profile.amount),
         "\(l10n.string(.paychecksCardNextWindow)): \(nextWindow(profile))",
         l10n.string(.paychecksCardNotGuaranteed),
         "\(l10n.string(.paychecksFactsLinkedDeposits)): \(linkedCount(profile))"].joined(separator: ". ")
    }
}
