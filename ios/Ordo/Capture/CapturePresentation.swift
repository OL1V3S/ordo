import Foundation

/// Maps capture state to the app's own strings. Server text is never shown: an error code or a
/// status has already been turned into one of these states.
struct CapturePresenter: Sendable {
    let l10n: L10n

    static func titleKey(_ kind: CaptureKind) -> L10nKey {
        kind == .expense ? .captureAddExpense : .captureAddDeposit
    }

    static func saveKey(_ kind: CaptureKind) -> L10nKey {
        kind == .expense ? .captureSaveExpense : .captureSaveDeposit
    }

    static func legendKey(_ kind: CaptureKind) -> L10nKey {
        kind == .expense ? .captureExpenseLegend : .captureDepositLegend
    }

    static func kindLabelKey(_ kind: CaptureKind) -> L10nKey {
        kind == .expense ? .homeActivityExpense : .homeActivityCashIn
    }

    static func fieldErrorKey(_ field: CaptureField) -> L10nKey {
        switch field {
        case .description: .captureDescriptionInvalid
        case .amount: .captureAmountInvalid
        case .date: .captureDateInvalid
        case .category: .captureCategoryInvalid
        }
    }

    static func formErrorKey(_ error: CaptureViewModel.FormError) -> L10nKey {
        switch error {
        case .checkFields: .captureCheckFields
        case .couldNotSave: .captureGenericError
        case .couldNotPrepare: .capturePersistFailed
        }
    }

    static func noticeKey(_ notice: CaptureViewModel.Notice) -> L10nKey {
        switch notice {
        case .saved(.expense): .captureFeedbackExpenseSaved
        case .saved(.deposit): .captureFeedbackDepositSaved
        case .savedRefreshFailed(.expense): .captureFeedbackExpenseSavedRefreshFailed
        case .savedRefreshFailed(.deposit): .captureFeedbackDepositSavedRefreshFailed
        case .recordDeleted: .captureRecordDeleted
        case .keyReused: .captureKeyReused
        }
    }

    /// The locked values of a waiting save, formatted for display and VoiceOver.
    struct Summary: Equatable, Sendable {
        let kind: String
        let amount: String
        let description: String
        let date: String
        let category: String?
    }

    func summary(of save: PendingSave) -> Summary {
        let amount = Money.parse(save.amount).map {
            MoneyFormatter(language: l10n.language, currencyCode: "USD").string($0)
        } ?? save.amount
        let date = CalendarDate(save.date).map { DateFormatting.string($0, language: l10n.language) } ?? save.date
        return Summary(kind: l10n.string(Self.kindLabelKey(save.kind)), amount: amount,
                       description: save.descriptionText, date: date,
                       category: save.kind == .expense ? CategoryLabel.label(for: save.category, l10n: l10n) : nil)
    }
}
