import Foundation

/// USD with exact digits. English shows `$1,234.56`; Spanish shows the ISO code
/// (`USD 1,234.56`), never a bare `$` and never `MX$` (matches the web's `formatMoneyCents`).
struct MoneyFormatter: Sendable {
    let language: AppLanguage
    let currencyCode: String

    func string(_ money: Money) -> String {
        let style = Decimal.FormatStyle.Currency(code: currencyCode, locale: language.formatLocale)
            .presentation(language == .es ? .isoCode : .standard)
            .precision(.fractionLength(2))
            .grouping(.automatic)
        return style.format(money.decimal)
    }

    /// Activity rows: expenses carry a minus sign, cash-ins a plus sign (as on the web).
    func signedString(_ money: Money, kind: ActivityItem.Kind) -> String {
        (kind == .expense ? "−" : "+") + string(money)
    }
}
