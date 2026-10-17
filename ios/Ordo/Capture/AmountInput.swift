import Foundation

/// Locale-aware amount entry. The text is turned into an exact `Money` (integer cents), never a
/// `Double`. The shape mirrors the web: `^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$`, above zero, at most
/// 9999999999999999.99.
enum AmountInput {
    /// Returns nil for anything that is not an acceptable amount.
    ///
    /// The decimal separator may be the app format locale's (`.` for both `en_US` and `es_MX`) or
    /// the device keyboard locale's (for example `,`). Grouping separators, signs, exponents,
    /// currency symbols, spaces inside the number and non-ASCII digits are rejected, never
    /// stripped, so `1,234` can never be misread.
    static func parse(_ text: String, language: AppLanguage, deviceLocale: Locale) -> Money? {
        var separators = Set<Unicode.Scalar>()
        for locale in [language.formatLocale, deviceLocale] {
            if let separator = locale.decimalSeparator, separator.unicodeScalars.count == 1,
               let scalar = separator.unicodeScalars.first {
                separators.insert(scalar)
            }
        }

        var whole: [Unicode.Scalar] = []
        var fraction: [Unicode.Scalar] = []
        var seenSeparator = false
        for scalar in text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars {
            if scalar.value >= 0x30, scalar.value <= 0x39 {
                if seenSeparator { fraction.append(scalar) } else { whole.append(scalar) }
            } else if separators.contains(scalar), !seenSeparator {
                seenSeparator = true
            } else {
                return nil
            }
        }
        if seenSeparator {
            guard (1...2).contains(fraction.count) else { return nil }
        } else {
            guard !whole.isEmpty else { return nil }
        }

        // Strip leading zeros, keeping a single 0, before the 16-digit check (as the web does).
        var digits = Array(whole.drop { $0.value == 0x30 })
        if digits.isEmpty { digits = [Unicode.Scalar(0x30)] }
        guard digits.count <= 16 else { return nil }

        var canonical = String(String.UnicodeScalarView(digits)) + "."
        canonical += String(String.UnicodeScalarView(fraction))
        if fraction.count == 0 { canonical += "00" } else if fraction.count == 1 { canonical += "0" }
        return Money.parse(canonical)
    }
}
