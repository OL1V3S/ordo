import Foundation

/// Turns a draft into the frozen values of a `PendingSave`, applying the same rules as the
/// server (`ExpenseInputRules`, `AccountInflowInputRules`). The server still has the final say.
enum CaptureValidation {
    /// Lengths are UTF-16 code units, matching .NET `string.Length` and JavaScript `length`.
    static let maximumDescriptionUnits = 500
    static let maximumCategoryUnits = 100
    static let reservedCategory = "other"
    static let defaultCategory = "uncategorized"

    struct Failure: Error, Equatable {
        let fields: Set<CaptureField>
        var first: CaptureField? { fields.min() }
    }

    static func normalizeDescription(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Trim, collapse whitespace runs to one space, lowercase (as the server does).
    static func normalizeCategory(_ text: String) -> String {
        text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ").lowercased()
    }

    /// The category text to send for a choice, or nil when the custom text is not acceptable.
    static func category(for draft: CaptureDraft) -> String? {
        let value: String
        switch draft.category {
        case .custom:
            let normalized = normalizeCategory(draft.customCategory)
            value = normalized.isEmpty ? defaultCategory : normalized
        default:
            value = draft.category.rawValue
        }
        guard value != reservedCategory, value.utf16.count <= maximumCategoryUnits else { return nil }
        return value
    }

    static func freeze(_ draft: CaptureDraft, kind: CaptureKind, key: String, createdAt: Date,
                       language: AppLanguage, deviceLocale: Locale) -> Result<PendingSave, Failure> {
        var invalid = Set<CaptureField>()

        let description = normalizeDescription(draft.description)
        if !(1...maximumDescriptionUnits).contains(description.utf16.count) { invalid.insert(.description) }

        let money = AmountInput.parse(draft.amountText, language: language, deviceLocale: deviceLocale)
        if money == nil { invalid.insert(.amount) }

        var category: String?
        if kind == .expense {
            category = Self.category(for: draft)
            if category == nil { invalid.insert(.category) }
        }

        guard invalid.isEmpty, let money else { return .failure(Failure(fields: invalid)) }
        return .success(PendingSave(schemaVersion: PendingSave.currentSchemaVersion, kind: kind, key: key,
                                    amount: money.text, descriptionText: description, date: draft.date.isoString,
                                    category: category, createdAt: createdAt))
    }
}
