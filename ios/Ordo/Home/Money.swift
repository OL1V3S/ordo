import Foundation

/// An exact USD amount parsed from the backend's fixed two-decimal invariant string.
/// Amounts are never carried as `Double`.
struct Money: Hashable, Sendable {
    /// The canonical text, for example `"1234.50"`.
    let text: String
    /// Exact integer cents (at most 999999999999999999, the web's maximum).
    let cents: Int64

    static let maximumCents: Int64 = 999_999_999_999_999_999

    /// Accepts only `^(0|[1-9]\d*)\.\d{2}$` with at most 16 whole digits. Zero is rejected
    /// unless `allowZero` is set (mirrors `parseExactMoney` in the web app).
    static func parse(_ text: String, allowZero: Bool = false) -> Money? {
        let bytes = Array(text.utf8)
        guard bytes.count >= 4, bytes[bytes.count - 3] == 0x2E else { return nil }
        let whole = bytes[0..<(bytes.count - 3)]
        let fraction = bytes[(bytes.count - 2)...]
        guard whole.count <= 16, whole.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              fraction.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
        if whole.count > 1, whole.first == 0x30 { return nil }
        var cents: Int64 = 0
        for byte in whole { cents = cents * 10 + Int64(byte - 0x30) }
        cents = cents * 100
        let fractionValue = fraction.reduce(Int64(0)) { $0 * 10 + Int64($1 - 0x30) }
        cents += fractionValue
        guard cents <= maximumCents, allowZero || cents > 0 else { return nil }
        return Money(text: text, cents: cents)
    }

    /// Exact decimal value for formatting (parsed with the POSIX locale).
    var decimal: Decimal {
        Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) ?? 0
    }
}
