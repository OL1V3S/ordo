import Foundation

/// Checks the budget form on the phone with the same rules the server and the web apply. The server
/// still has the final say (`400` shows the same validation message).
enum BudgetValidation {
    struct Failure: Error, Equatable {
        let fields: Set<BudgetField>
        var first: BudgetField? { fields.min() }
    }

    /// The limit: entered with the shared amount input, zero or more, at most two decimals, and
    /// below 2^46 dollars, so the app never saves a limit that it and the web would read back as
    /// "Exact limit unavailable". Blank, negative and three-decimal input are rejected.
    static func limit(_ text: String, language: AppLanguage, deviceLocale: Locale) -> Money? {
        guard let money = AmountInput.parse(text, language: language, deviceLocale: deviceLocale, allowZero: true),
              money.cents <= BudgetLimitsValidation.maximumLimitCents else { return nil }
        return money
    }

    /// The category to send for an Add: a fixed key (`food`, ...) or the custom text trimmed, with
    /// internal whitespace collapsed and lowercased (the Category invariant). Custom text that is
    /// blank sends `uncategorized`. `other` is never sent, and a category longer than 100
    /// characters is rejected, never truncated.
    static func addCategory(_ draft: BudgetDraft) -> String? {
        guard let choice = draft.choice else { return nil }
        let value: String
        if choice == .other {
            let normalized = CaptureValidation.normalizeCategory(draft.customCategory)
            value = normalized.isEmpty ? CaptureValidation.defaultCategory : normalized
        } else {
            value = choice.rawValue
        }
        guard value != CaptureValidation.reservedCategory,
              value.utf16.count <= CaptureValidation.maximumCategoryUnits else { return nil }
        return value
    }

    static func add(_ draft: BudgetDraft, month: BudgetMonth, language: AppLanguage,
                    deviceLocale: Locale) -> Result<BudgetUpsert, Failure> {
        var invalid = Set<BudgetField>()
        let category = addCategory(draft)
        if category == nil { invalid.insert(draft.choice == .other ? .customCategory : .category) }
        let limit = limit(draft.amountText, language: language, deviceLocale: deviceLocale)
        if limit == nil { invalid.insert(.amount) }
        guard invalid.isEmpty, let category, let limit else { return .failure(Failure(fields: invalid)) }
        return .success(BudgetUpsert(category: category, limit: limit, month: month))
    }

    /// An Edit changes only the limit. The category is the stored one, verbatim: the upsert key is
    /// case- and whitespace-sensitive, so normalizing it would create a new row instead of editing
    /// this one. A blank stored category is rejected (the server would answer `400`).
    static func edit(storedCategory: String, amountText: String, month: BudgetMonth, language: AppLanguage,
                     deviceLocale: Locale) -> Result<BudgetUpsert, Failure> {
        var invalid = Set<BudgetField>()
        if BudgetCategory.isBlank(storedCategory) { invalid.insert(.category) }
        let limit = limit(amountText, language: language, deviceLocale: deviceLocale)
        if limit == nil { invalid.insert(.amount) }
        guard invalid.isEmpty, let limit else { return .failure(Failure(fields: invalid)) }
        return .success(BudgetUpsert(category: storedCategory, limit: limit, month: month))
    }
}
