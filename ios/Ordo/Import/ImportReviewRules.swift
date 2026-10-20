import Foundation

/// Pure helpers behind the review summary, filters, bulk selection and totals; a port of the web's
/// `importReview.js`. Money stays in exact cents.
enum ImportReviewRules {
    struct Summary: Equatable {
        let total, expensesSelected, depositsSelected, possibleDuplicates, needsReview, cannotBeSelected: Int
    }

    static func isExpenseSelected(_ row: ImportRow) -> Bool { row.isEligible && row.selectedForImport }
    static func isDepositSelected(_ row: ImportRow) -> Bool { row.isInflowEligible && row.selectedForInflow }
    static func isRowSelected(_ row: ImportRow) -> Bool { isExpenseSelected(row) || isDepositSelected(row) }
    static func isPossibleDuplicate(_ row: ImportRow) -> Bool { row.isPossibleDuplicate || row.isPossibleInflowDuplicate }

    /// A content-less invalid row has nothing to review or edit; the list leaves it out and counts it.
    static func isUnreadable(_ row: ImportRow) -> Bool {
        row.classification == "invalid" && !row.isEligible && !row.isInflowEligible && row.postedDate == nil
            && row.amount == nil && row.sourceDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func needsReviewOrInvalid(_ row: ImportRow) -> Bool {
        row.classification == "needs_review" || row.classification == "invalid"
    }

    static func summarize(_ rows: [ImportRow]) -> Summary {
        Summary(total: rows.count, expensesSelected: rows.filter(isExpenseSelected).count,
                depositsSelected: rows.filter(isDepositSelected).count,
                possibleDuplicates: rows.filter(isPossibleDuplicate).count,
                needsReview: rows.filter(needsReviewOrInvalid).count,
                cannotBeSelected: rows.filter { !$0.isEligible && !$0.isInflowEligible }.count)
    }

    static func matches(_ row: ImportRow, _ filter: ImportFilter) -> Bool {
        switch filter {
        case .all: true
        case .attention: needsReviewOrInvalid(row) || !row.errors.isEmpty
        case .duplicates: isPossibleDuplicate(row)
        case .deposits: row.classification == "non_expense" && row.direction == "credit"
        case .selected: isRowSelected(row)
        }
    }

    static func counts(_ rows: [ImportRow]) -> [ImportFilter: Int] {
        Dictionary(uniqueKeysWithValues: ImportFilter.allCases.map { filter in
            (filter, rows.filter { matches($0, filter) }.count)
        })
    }

    /// The server's default selection: eligible expense candidates with no duplicate signal.
    static func bulkSelectableExpenses(_ rows: [ImportRow]) -> [ImportRow] {
        rows.filter { $0.isEligible && !$0.isPossibleDuplicate && !$0.isPossibleInflowDuplicate
            && $0.duplicateExpenseIds.isEmpty && $0.classification == "expense_candidate" && !$0.selectedForImport }
    }

    static func bulkClearTargets(_ rows: [ImportRow]) -> [ImportRow] { rows.filter(isRowSelected) }

    /// nil when any amount is missing or the sum is out of range.
    static func totalCents(_ rows: [ImportRow]) -> Int64? {
        var total: Int64 = 0
        for row in rows {
            guard let cents = row.amount?.cents else { return nil }
            let (sum, overflow) = total.addingReportingOverflow(cents)
            guard !overflow else { return nil }
            total = sum
        }
        return total
    }

    struct Totals: Equatable {
        let expenseCount: Int
        let expenses: Money?
        let depositCount: Int
        let deposits: Money?
    }

    static func selectedTotals(_ rows: [ImportRow]) -> Totals {
        let expenses = rows.filter(isExpenseSelected)
        let deposits = rows.filter(isDepositSelected)
        return Totals(expenseCount: expenses.count, expenses: totalCents(expenses).flatMap(Money.fromCents),
                      depositCount: deposits.count, deposits: totalCents(deposits).flatMap(Money.fromCents))
    }
}
