import Foundation

/// The digit layout of a locale's formatted number (prefix, suffix, separators), read from a
/// sample, so exact digits can be placed into it without a `Double` or a `Decimal`. The same
/// approach as the web's `substituteDigits`.
struct DigitPattern: Sendable {
    let prefix: String
    let suffix: String
    let groupSeparator: String?
    let decimalSeparator: String
    let fractionDigits: Int

    /// `sample` holds a number with a grouped integer part (or none) and `fractionDigits` fraction digits.
    init(sample: String, fractionDigits: Int) {
        let chars = Array(sample)
        let isDigit: (Character) -> Bool = { $0.isASCII && $0.isNumber }
        let first = chars.firstIndex(where: isDigit) ?? 0
        let last = chars.lastIndex(where: isDigit) ?? max(0, chars.count - 1)
        prefix = String(chars[..<first])
        suffix = String(chars[(last + 1)...])
        let core = Array(chars[first...last])
        decimalSeparator = core.count > fractionDigits ? String(core[core.count - fractionDigits - 1]) : "."
        let integerPart = core.count > fractionDigits + 1 ? Array(core[..<(core.count - fractionDigits - 1)]) : []
        groupSeparator = integerPart.first(where: { !isDigit($0) }).map(String.init)
        self.fractionDigits = fractionDigits
    }

    func render(integerDigits: String, fractionDigits fraction: String, grouped: Bool) -> String {
        var integer = integerDigits
        if grouped, let separator = groupSeparator {
            var out = ""
            for (offset, character) in integerDigits.enumerated() {
                if offset > 0, (integerDigits.count - offset) % 3 == 0 { out += separator }
                out.append(character)
            }
            integer = out
        }
        return prefix + integer + decimalSeparator + fraction + suffix
    }
}

/// Exact money and percentage text, ported from the web's `formatCash` and `cashPercentage`.
struct ReportsFormatter: Sendable {
    let language: AppLanguage
    private let money: DigitPattern
    private let percent: DigitPattern

    init(language: AppLanguage) {
        self.language = language
        let sampleMoney = Decimal.FormatStyle.Currency(code: "USD", locale: language.formatLocale)
            .presentation(language == .es ? .isoCode : .standard)
            .precision(.fractionLength(2)).grouping(.automatic)
            .format(Decimal(string: "1111111.11")!)
        money = DigitPattern(sample: sampleMoney, fractionDigits: 2)
        let samplePercent = Decimal.FormatStyle.Percent(locale: language.formatLocale)
            .precision(.fractionLength(1)).grouping(.never)
            .format(Decimal(string: "0.111")!)
        percent = DigitPattern(sample: samplePercent, fractionDigits: 1)
    }

    /// `−` (U+2212) for a negative value, `+` for a positive one when `signed`, then the money text
    /// of the absolute value. Exact for any value, including above 2^53 and `Int64`.
    func cash(_ amount: CashAmount, signed: Bool = false) -> String {
        let sign = amount.isNegative ? "−" : (signed && amount.isPositive ? "+" : "")
        let magnitude = amount.magnitude
        let fraction = String(magnitude % 100)
        let text = money.render(integerDigits: String(magnitude / 100),
                                fractionDigits: String(repeating: "0", count: 2 - fraction.count) + fraction,
                                grouped: true)
        return sign + text
    }

    /// `part` as a share of `whole`, rounded to a tenth with halves up; nil when `whole` is not
    /// positive or the result does not fit. Never grouped and never capped at 100%.
    func percentage(_ part: CashAmount, of whole: CashAmount) -> String? {
        guard let tenths = Self.tenths(part, of: whole) else { return nil }
        let magnitude = tenths < 0 ? -tenths : tenths
        let text = percent.render(integerDigits: String(magnitude / 10), fractionDigits: String(magnitude % 10), grouped: false)
        return (tenths < 0 ? "−" : "") + text
    }

    /// `(part * 2000 + whole) / (whole * 2)` with half up, written as quotient and remainder so it
    /// cannot overflow for any realistic value; nil if it still would.
    static func tenths(_ part: CashAmount, of whole: CashAmount) -> Int128? {
        guard whole.value > 0 else { return nil }
        let quotient = part.value / whole.value
        let remainder = part.value % whole.value
        let (scaled, overflowA) = remainder.multipliedReportingOverflow(by: 2000)
        let (plus, overflowB) = scaled.addingReportingOverflow(whole.value)
        let (twice, overflowC) = whole.value.multipliedReportingOverflow(by: 2)
        let (whole1000, overflowD) = quotient.multipliedReportingOverflow(by: 1000)
        guard !overflowA, !overflowB, !overflowC, !overflowD else { return nil }
        let (result, overflowE) = whole1000.addingReportingOverflow(plus / twice)
        return overflowE ? nil : result
    }

    /// A decorative bar fraction, 0 when `maximum` is not positive. Chart and bar geometry only.
    static func barFraction(_ part: CashAmount, of maximum: CashAmount) -> Double {
        guard maximum.value > 0 else { return 0 }
        let quotient = part.value / maximum.value
        let remainder = part.value % maximum.value
        let (scaled, overflowA) = remainder.multipliedReportingOverflow(by: 10_000)
        let (head, overflowB) = quotient.multipliedReportingOverflow(by: 10_000)
        guard !overflowA, !overflowB else { return Double(part.value) / Double(maximum.value) }
        return Double(head + scaled / maximum.value) / 10_000
    }
}
