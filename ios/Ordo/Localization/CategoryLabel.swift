import Foundation

/// Known stored categories show a localized label; anything else is shown exactly as stored.
/// Matching is trimmed and case-insensitive (`categoryLabel.js`), because stored values are
/// capitalized (for example `Food`).
enum CategoryLabel {
    private static let keys: [String: L10nKey] = [
        "food": .categoryFood, "transport": .categoryTransport, "bills": .categoryBills,
        "entertainment": .categoryEntertainment, "other": .categoryOther, "uncategorized": .categoryUncategorized,
    ]

    static func label(for category: String?, l10n: L10n) -> String {
        guard let category else { return l10n.string(.categoryUncategorized) }
        let key = category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return keys[key].map { l10n.string($0) } ?? category
    }
}
