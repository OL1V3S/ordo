import Foundation

/// Display rules for the Transactions views and their tests. Server text is never shown: every
/// message here is one of the app's own strings. Descriptions and categories appear only as data.
struct TransactionsPresenter: Sendable {
    let l10n: L10n

    private var money: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: "USD") }

    // MARK: Rows

    func kindLabel(_ kind: TimelineItem.Kind) -> String {
        kind == .expense ? l10n.string(.homeActivityExpense) : l10n.string(.homeActivityCashIn)
    }

    func date(_ date: CalendarDate) -> String { DateFormatting.string(date, language: l10n.language) }

    /// The signed amount (a minus for an expense, a plus for a deposit), or "Exact amount
    /// unavailable" when the stored amount is not a positive exact amount.
    func amountText(_ item: TimelineItem) -> String {
        switch item.amount {
        case .exact(let value): money.signedString(value, kind: item.kind)
        case .needsReview: l10n.string(.homeActivityAmountReview)
        }
    }

    /// The stored text of an amount that needs review, shown as it is; nil for an exact amount.
    func storedAmountText(_ item: TimelineItem) -> String? {
        if case .needsReview(let stored) = item.amount { return stored }
        return nil
    }

    static func direction(for item: TimelineItem) -> AmountDirection {
        item.kind == .expense ? .moneyOut : .moneyIn
    }

    /// Kind, date, category (expenses) and the paycheck link, on one line.
    func details(_ item: TimelineItem) -> String {
        var parts = [kindLabel(item.kind), date(item.date)]
        if item.kind == .expense { parts.append(CategoryLabel.label(for: item.category, l10n: l10n)) }
        if item.paycheckLinked { parts.append(l10n.string(.homeActivityPaycheckLinked)) }
        return parts.joined(separator: " · ")
    }

    /// One VoiceOver sentence for a row: kind, description, date, category, link and amount.
    func accessibilityLabel(_ item: TimelineItem) -> String {
        var parts = [kindLabel(item.kind), item.descriptionText, date(item.date)]
        if item.kind == .expense { parts.append(CategoryLabel.label(for: item.category, l10n: l10n)) }
        if item.paycheckLinked { parts.append(l10n.string(.homeActivityPaycheckLinked)) }
        parts.append(amountText(item))
        if let stored = storedAmountText(item) { parts.append(stored) }
        return parts.joined(separator: ", ")
    }

    // MARK: Actions

    /// An expense whose stored amount is not a positive exact amount has Delete only; a deposit can
    /// always be edited (its amount is entered again). This matches the web.
    static func canEdit(_ item: TimelineItem) -> Bool {
        switch item.amount {
        case .exact: true
        case .needsReview: item.kind != .expense
        }
    }

    func editActionLabel(_ item: TimelineItem) -> String {
        l10n.string(item.kind == .expense ? .timelineActionsEditExpense : .timelineActionsEditCashIn,
                    item.descriptionText, date(item.date), String(item.recordId))
    }

    func deleteActionLabel(_ item: TimelineItem) -> String {
        l10n.string(item.kind == .expense ? .timelineActionsDeleteExpense : .timelineActionsDeleteCashIn,
                    item.descriptionText, date(item.date), String(item.recordId))
    }

    // MARK: Edit

    /// The edit form for a timeline row. The description keeps its case. An amount that needs
    /// review is left empty, to be entered again. A stored category that is not one of the fixed
    /// choices is edited as custom text; a legacy `other` or an empty one is rejected or replaced on
    /// save, so the category invariant holds.
    static func editDraft(for item: TimelineItem) -> CaptureDraft {
        var draft = CaptureDraft(date: item.date)
        draft.description = item.descriptionText
        if case .exact(let value) = item.amount { draft.amountText = value.text }
        if item.kind == .expense {
            let stored = item.category ?? ""
            let normalized = stored.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if let choice = CategoryChoice(rawValue: normalized), choice != .custom {
                draft.category = choice
            } else {
                draft.category = .custom
                draft.customCategory = stored
            }
        }
        return draft
    }

    func editTitle(_ kind: CaptureKind) -> String {
        l10n.string(kind == .expense ? .expenseEditTitle : .cashInFormEditTitle)
    }

    // MARK: Delete

    /// A heading that names the record, for the confirmation.
    func deleteHeading(_ item: TimelineItem) -> String {
        l10n.string(item.kind == .expense ? .transactionsDeleteExpenseHeading : .cashInDeleteHeading,
                    item.descriptionText, date(item.date))
    }

    func deleteMessage(_ item: TimelineItem) -> String? {
        guard item.kind == .accountInflow else { return nil }
        return l10n.string(.cashInDeleteBody) + "\n\n" + l10n.string(.cashInDeleteImported)
    }

    func deleteConfirm(_ kind: CaptureKind) -> String {
        l10n.string(kind == .expense ? .transactionsDeleteExpenseConfirm : .cashInDeleteConfirm)
    }

    // MARK: Filters

    /// "Active filters: Search: “x” · Deposit · From … · Through …".
    func filterSummary(_ filter: TimelineFilter) -> String {
        var parts: [String] = []
        let search = TimelineFilterRules.trimmedSearch(filter.q)
        if !search.isEmpty { parts.append(l10n.string(.timelineFiltersSummarySearch, search)) }
        switch filter.kind {
        case .all: break
        case .expense: parts.append(l10n.string(.homeActivityExpense))
        case .accountInflow: parts.append(l10n.string(.homeActivityCashIn))
        }
        if let from = filter.from { parts.append(l10n.string(.timelineFiltersSummaryFrom, date(from))) }
        if let to = filter.to { parts.append(l10n.string(.timelineFiltersSummaryTo, date(to))) }
        return l10n.string(.timelineFiltersActivePrefix) + " " + parts.joined(separator: " · ")
    }

    func kindFilterLabel(_ kind: TimelineKindFilter) -> String {
        switch kind {
        case .all: l10n.string(.timelineFiltersKindAll)
        case .expense: l10n.string(.homeActivityExpense)
        case .accountInflow: l10n.string(.homeActivityCashIn)
        }
    }

    // MARK: Messages

    static func failureKey(_ failure: TransactionsViewModel.Failure) -> L10nKey {
        switch failure {
        case .offline: .appOffline
        case .unavailable, .generic: .timelineUnavailable
        case .filterRejected: .timelineFiltersInvalid
        }
    }

    static func noticeKey(_ notice: TransactionMutationViewModel.Notice) -> L10nKey {
        switch notice {
        case .updated(.expense): .spendingFeedbackUpdated
        case .updated(.deposit): .cashInFeedbackUpdated
        case .deleted(.expense): .spendingFeedbackDeleted
        case .deleted(.deposit): .cashInFeedbackDeleted
        case .missing(.expense): .transactionsMissingExpense
        case .missing(.deposit): .transactionsMissingDeposit
        case .updatedRefreshFailed(.expense): .transactionsUpdatedRefreshFailedExpense
        case .updatedRefreshFailed(.deposit): .transactionsUpdatedRefreshFailedDeposit
        case .deletedRefreshFailed(.expense): .transactionsDeletedRefreshFailedExpense
        case .deletedRefreshFailed(.deposit): .transactionsDeletedRefreshFailedDeposit
        case .checkList: .transactionsCheckNotice
        }
    }

    static func formErrorKey(_ error: TransactionMutationViewModel.FormError) -> L10nKey {
        switch error {
        case .checkFields: .captureCheckFields
        case .couldNotSave: .transactionsGenericError
        }
    }

    static func uncertainTitleKey(isDelete: Bool) -> L10nKey {
        isDelete ? .transactionsUncertainDeleteTitle : .transactionsUncertainEditTitle
    }

    static func uncertainMessageKey(isDelete: Bool) -> L10nKey {
        isDelete ? .transactionsUncertainDeleteMessage : .transactionsUncertainEditMessage
    }
}
