import Foundation

/// An exact signed integer-cent amount from the cash-flow endpoint. The server sends every amount
/// as a canonical string (`^(0|-?[1-9]\d*)$`), because totals can exceed 2^53 and even `Int64`.
/// The value is held as `Int128` and is never carried as `Double`. Nothing here is summed or
/// subtracted: the amounts are shown as the server sent them.
struct CashAmount: Hashable, Comparable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let value: Int128

    init(_ value: Int128) { self.value = value }

    /// Strict web `minorUnits` grammar, ASCII digits only. Anything else (`-0`, `01`, `+5`, `1.00`,
    /// whitespace, an exponent, an empty string, a value beyond `Int128`) is nil.
    init?(_ text: String) {
        let bytes = Array(text.utf8)
        guard !bytes.isEmpty else { return nil }
        let negative = bytes[0] == 0x2D
        let digits = negative ? Array(bytes.dropFirst()) : bytes
        guard !digits.isEmpty, digits.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
        if digits[0] == 0x30 && (digits.count > 1 || negative) { return nil }
        var magnitude: Int128 = 0
        for byte in digits {
            let (times, overflowA) = magnitude.multipliedReportingOverflow(by: 10)
            let (plus, overflowB) = times.addingReportingOverflow(Int128(byte - 0x30))
            guard !overflowA, !overflowB else { return nil }
            magnitude = plus
        }
        value = negative ? -magnitude : magnitude
    }

    var isZero: Bool { value == 0 }
    var isNegative: Bool { value < 0 }
    var isPositive: Bool { value > 0 }
    /// `value` without its sign. Safe because parsing never produces `Int128.min`.
    var magnitude: Int128 { value < 0 ? -value : value }

    /// The canonical text.
    var canonical: String { String(value) }

    static func < (lhs: CashAmount, rhs: CashAmount) -> Bool { lhs.value < rhs.value }

    /// Approximate dollars for chart geometry only. Never shown and never compared.
    var approximateDollars: Double { Double(value) / 100 }

    /// Redacted: amounts are never logged or printed.
    var description: String { "CashAmount(redacted)" }
    var debugDescription: String { "CashAmount(redacted)" }
}
