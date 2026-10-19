import Foundation

/// Display rules for the Budgets views and their tests. Server text is never shown: every message
/// here is one of the app's own strings. Categories and amounts appear only as data.
struct BudgetsPresenter: Sendable {
    let l10n: L10n

    private var money: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: "USD") }

    // MARK: Names

    /// A port of the web's `categoryLabel(t, category, displayText)`: a known key (trimmed,
    /// case-insensitive) gets its localized label; a custom category is title-cased per word, for
    /// display only. A blank category is shown as stored. Stored and sent values are never altered.
    func categoryName(_ stored: String) -> String {
        if let key = CategoryLabel.knownKey(for: stored) { return l10n.string(key) }
        if BudgetCategory.isBlank(stored) { return stored }
        return Self.displayText(stored)
    }

    /// A port of `displayText` in `utils/text.js`: trim, split on whitespace runs, capitalize the
    /// first letter of each word, join with single spaces.
    static func displayText(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    func monthLabel(_ month: BudgetMonth) -> String { month.label(language: l10n.language) }

    /// The first day of the next month, as a short date; nil after 9999-12.
    func nextResetDate(for month: BudgetMonth) -> String? {
        month.nextResetDay.map { DateFormatting.string($0, language: l10n.language) }
    }

    // MARK: Amounts

    func amountText(cents: Int64?) -> String {
        guard let cents, let value = Money.fromCents(cents) else { return l10n.string(.budgetsCardUnavailable) }
        return money.string(value)
    }

    /// A whole percent such as "45%" or "1,234%". The integer is grouped with the locale's grouping
    /// separator and is exact for any size; the percent sign follows with no space, as the web
    /// shows it in both languages.
    func percentText(_ whole: Int128) -> String {
        Self.percentText(whole, language: l10n.language)
    }

    static func percentText(_ whole: Int128, language: AppLanguage) -> String {
        let digits = Array(String(whole.magnitude))
        let separator = language.formatLocale.groupingSeparator ?? ","
        var grouped = ""
        for (offset, digit) in digits.enumerated() {
            if offset > 0, (digits.count - offset) % 3 == 0 { grouped += separator }
            grouped.append(digit)
        }
        return (whole < 0 ? "-" : "") + grouped + "%"
    }

    // MARK: Cards

    /// Everything a row shows and says, for one limit and its evaluation.
    struct Card: Equatable, Sendable {
        let name: String
        let statusText: String
        let usedText: String
        let usedOfText: String
        /// "{percent} used" for a positive limit with an exact comparison.
        let percentUsedText: String?
        /// The bar, in tenths of a percent from 0 to 1000 (capped at 100%).
        let barTenths: Int?
        let note: String?
        let warning: Bool
        let status: BudgetStatus
        /// The bar's spoken label and value: "{used} used of {limit}, {percent}".
        let progressLabel: String
        let progressValue: String?
        /// One sentence for the row: name, status, the spoken progress value (or used of limit), note.
        let accessibilityLabel: String
    }

    func card(for row: BudgetLimitRow, evaluation: BudgetEvaluation) -> Card {
        let name = categoryName(row.category)
        let usedText = amountText(cents: evaluation.usedCents)
        let limitText = amountText(cents: evaluation.limitCents)
        let usedOf = l10n.string(.budgetsCardUsedOf, limitText)
        let status = l10n.string(evaluation.status.labelKey)

        var percentUsed: String?
        var progressValue: String?
        if let whole = evaluation.percentWhole {
            let percent = percentText(whole)
            percentUsed = l10n.string(.budgetsCardPercentUsed, percent)
            progressValue = l10n.string(.budgetsCardProgressValue, usedText, limitText, percent)
        }
        let note: String?
        if evaluation.showsZeroLimitNote {
            note = l10n.string(.budgetsCardZeroLimitNote)
        } else if evaluation.showsComparisonUnavailable {
            note = l10n.string(.budgetsCardComparisonUnavailable)
        } else {
            note = nil
        }

        var spoken = [l10n.string(.budgetsCardAriaLabel, name), status, progressValue ?? (usedText + " " + usedOf)]
        if let note { spoken.append(note) }
        return Card(name: name, statusText: status, usedText: usedText, usedOfText: usedOf,
                    percentUsedText: percentUsed, barTenths: evaluation.barTenths, note: note,
                    warning: evaluation.warning, status: evaluation.status,
                    progressLabel: l10n.string(.budgetsCardProgressLabel, name), progressValue: progressValue,
                    accessibilityLabel: spoken.joined(separator: ", "))
    }

    func editActionLabel(_ row: BudgetLimitRow) -> String { l10n.string(.budgetsCardEditLabel, categoryName(row.category)) }
    func deleteActionLabel(_ row: BudgetLimitRow) -> String { l10n.string(.budgetsCardDeleteLabel, categoryName(row.category)) }
    func actionsLabel(_ row: BudgetLimitRow) -> String { l10n.string(.budgetsCardActionsLabel, categoryName(row.category)) }

    // MARK: Messages

    func confirmDeleteTitle(_ row: BudgetLimitRow) -> String {
        l10n.string(.budgetsConfirmDelete, categoryName(row.category))
    }

    func taskNote(month: BudgetMonth) -> String { l10n.string(.budgetsTaskNote, monthLabel(month)) }
    func limitsError(month: BudgetMonth) -> String { l10n.string(.budgetsStatesLimitsError, monthLabel(month)) }

    func formHeading(_ task: BudgetsViewModel.TaskKind) -> String {
        switch task {
        case .add: l10n.string(.budgetsFormAddHeading)
        case .edit(let row): l10n.string(.budgetsFormEditHeading, categoryName(row.category))
        }
    }

    func forMonth(_ month: BudgetMonth) -> String { l10n.string(.budgetsFormForMonth, monthLabel(month)) }

    func limitFieldLabel(_ task: BudgetsViewModel.TaskKind) -> String {
        switch task {
        case .add: l10n.string(.budgetsFormLimitAmount)
        case .edit(let row): l10n.string(.budgetsFormEditLimitAmount, categoryName(row.category))
        }
    }

    static func feedbackKey(_ feedback: BudgetsViewModel.Feedback) -> L10nKey {
        switch feedback {
        case .saved: .budgetsFeedbackSaved
        case .savedRefreshFailed: .budgetsFeedbackSavedRefreshFailed
        case .deleted: .budgetsFeedbackDeleted
        case .deletedRefreshFailed: .budgetsFeedbackDeletedRefreshFailed
        case .unconfirmed: .budgetsFeedbackUnconfirmed
        case .refreshed: .budgetsFeedbackRefreshed
        }
    }

    static func feedbackTone(_ feedback: BudgetsViewModel.Feedback) -> StatusTone {
        switch feedback {
        case .saved, .deleted: .success
        case .savedRefreshFailed, .deletedRefreshFailed: .warning
        case .unconfirmed: .danger
        case .refreshed: .info
        }
    }

    static func feedbackIcon(_ feedback: BudgetsViewModel.Feedback) -> String {
        switch feedback {
        case .saved, .deleted: "checkmark.circle"
        case .savedRefreshFailed, .deletedRefreshFailed, .unconfirmed: "exclamationmark.triangle"
        case .refreshed: "info.circle"
        }
    }
}
