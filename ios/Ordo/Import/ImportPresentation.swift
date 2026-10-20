import Foundation

/// Text for the import screens, from the catalog only. Server text is never shown; the `code` of a
/// refusal picks a catalog entry from the web's allow-list, otherwise a fallback.
struct ImportPresenter {
    let l10n: L10n
    private var formatter: MoneyFormatter { MoneyFormatter(language: l10n.language, currencyCode: "USD") }

    static let uploadCodes: Set<String> = [
        "upload_too_large", "invalid_pdf", "encrypted_pdf", "image_only_pdf", "unsupported_statement_source",
        "source_required", "unsupported_statement_format", "candidate_row_limit_exceeded", "processing_timed_out",
        "processing_cancelled", "import_in_progress", "already_imported",
    ]
    static let rowCodes: Set<String> = ["row_not_selectable", "row_validation_failed"]
    static let confirmCodes: Set<String> = [
        "no_rows_selected", "duplicate_review_required", "confirmation_validation_failed", "confirmation_conflict",
        "confirmation_failed", "preview_expired", "preview_unavailable",
    ]

    var panelTitle: String { string("panel.title") }

    func text(_ path: String) -> String { string(path) }

    func string(_ path: String, _ arguments: String...) -> String {
        guard let key = L10nKey(rawValue: "importPreview." + path) else { return path }
        return arguments.isEmpty ? l10n.string(key) : l10n.string(key, arguments: arguments)
    }

    func messageText(_ message: ImportViewModel.Message) -> String {
        switch message {
        case .upload(let code):
            string(code.flatMap { Self.uploadCodes.contains($0) ? "errors.\($0)" : nil } ?? "fallbackErrors.upload")
        case .uploadUncertain: string("ios.uploadUncertain")
        case .fileUnreadable: string("ios.fileUnreadable")
        case .update(let code):
            string(code.flatMap { Self.rowCodes.contains($0) ? "errors.\($0)" : nil } ?? "fallbackErrors.update")
        case .bulkFailed: string("bulk.failed")
        case .bulkUncertain: string("ios.reloadNeeded")
        case .confirm(let code):
            string("confirmation." + (code.flatMap { Self.confirmCodes.contains($0) ? $0 : nil } ?? "confirmation_failed"))
        case .duplicateRefreshFailed: string("confirmation.duplicateRefreshFailed")
        case .unavailable: string("confirmation.preview_unavailable")
        case .reloadFailed: string("ios.reloadFailed")
        }
    }

    func plural(_ path: String, _ count: Int, arguments: [String]? = nil) -> String {
        guard let key = L10nKey(rawValue: "importPreview.\(path)_\(count == 1 ? "one" : "other")") else { return path }
        return l10n.string(key, arguments: arguments ?? [String(count)])
    }

    func filterLabel(_ filter: ImportFilter, count: Int) -> String {
        string("filters.option", string("filters.\(filter.rawValue)"), String(count))
    }

    func showing(shown: Int, total: Int) -> String {
        plural("filters.showing", total, arguments: [String(shown), String(total)])
    }

    func selectionSummary(expenses: Int, deposits: Int) -> String {
        string("selection.summary", plural("selection.expenses", expenses), plural("selection.deposits", deposits))
    }

    func totalText(_ money: Money?) -> String { money.map(formatter.string) ?? string("bar.totalUnavailable") }

    func expensesBar(_ totals: ImportReviewRules.Totals) -> String {
        string("bar.expensesToSave", String(totals.expenseCount), totalText(totals.expenses))
    }

    func depositsBar(_ totals: ImportReviewRules.Totals) -> String {
        string("bar.depositsToSave", String(totals.depositCount), totalText(totals.deposits))
    }

    func saveTitle(_ totals: ImportReviewRules.Totals, saving: Bool) -> String {
        string(saving ? "results.saving" : "results.save",
               selectionSummary(expenses: totals.expenseCount, deposits: totals.depositCount))
    }

    func expiryMeta(rows: Int, expiresAt: Date?) -> String {
        let when = expiresAt.map {
            $0.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: l10n.language.formatLocale))
        } ?? string("row.unavailable")
        return plural("results.meta", rows, arguments: [String(rows), when])
    }

    func completionText(_ confirmation: ImportConfirmation) -> String {
        let summary = selectionSummary(expenses: confirmation.expenseCount, deposits: confirmation.depositCount)
        let base = confirmation.alreadyConfirmed ? "completion.alreadySaved" : "completion.saved"
        guard let at = confirmation.confirmedAt else { return string(base + "UnavailableTime", summary) }
        let when = at.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: l10n.language.formatLocale))
        return string(base, when, summary)
    }

    func completionTitle(_ confirmation: ImportConfirmation) -> String {
        string(confirmation.alreadyConfirmed ? "completion.alreadyTitle" : "completion.title")
    }

    // MARK: Rows

    func rowTitle(_ row: ImportRow) -> String {
        let edited = row.editableExpenseDescription?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let source = row.sourceDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if row.selectedForImport || row.isEligible, !edited.isEmpty { return edited }
        return source.isEmpty ? string("row.unavailable") : source
    }

    func dateText(_ row: ImportRow) -> String {
        row.postedDate.map { DateFormatting.string($0, language: l10n.language) } ?? string("row.unknownDate")
    }

    func amountText(_ row: ImportRow) -> String { row.amount.map(formatter.string) ?? string("row.unavailable") }

    func statusLabel(_ row: ImportRow) -> String {
        let known: Set<String> = ["expense_candidate", "non_expense", "needs_review", "invalid"]
        return string("row.statusLabels." + (known.contains(row.classification) ? row.classification : "default"))
    }

    func directionLabel(_ row: ImportRow) -> String? {
        row.direction == "debit" || row.direction == "credit" ? string("row.directions." + row.direction) : nil
    }

    private static let rowErrorCodes: Set<String> = [
        "invalid_transaction_date", "invalid_transaction_amount", "invalid_transaction_description",
        "unsupported_transaction_direction", "unsupported_transaction_row", "source_description_too_long",
        "date_required", "amount_must_be_positive", "amount_out_of_range", "amount_precision_invalid",
        "description_required", "description_too_long", "category_required", "category_too_long", "category_reserved",
    ]

    /// Row problems, warnings and duplicate signals as text; unknown codes are left out.
    func flags(_ row: ImportRow) -> [(text: String, tone: StatusTone)] {
        var result: [(String, StatusTone)] = []
        if row.isPossibleDuplicate { result.append((string("row.possibleDuplicate"), .warning)) }
        if row.isPossibleInflowDuplicate { result.append((string("row.possibleInflowDuplicate"), .warning)) }
        for code in row.errors where Self.rowErrorCodes.contains(code) {
            result.append((string("row.issue", string("row.errorCodes." + code)), .danger))
        }
        for code in row.warnings where Self.rowErrorCodes.contains(code) {
            result.append((string("row.warning", string("row.errorCodes." + code)), .warning))
        }
        return result
    }

    func categoryLabel(_ row: ImportRow) -> String { CategoryLabel.label(for: row.category, l10n: l10n) }
}
