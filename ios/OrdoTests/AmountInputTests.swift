import Foundation
import Testing
@testable import Ordo

@Suite struct AmountInputTests {
    private let us = Locale(identifier: "en_US")
    private let spain = Locale(identifier: "es_ES")

    private func parse(_ text: String, _ language: AppLanguage = .en, _ device: Locale? = nil) -> Money? {
        AmountInput.parse(text, language: language, deviceLocale: device ?? us)
    }

    @Test(arguments: [
        ("12.50", "12.50"), ("12.5", "12.50"), ("12", "12.00"), (".5", "0.50"), (".05", "0.05"),
        ("05", "5.00"), ("00.50", "0.50"), ("007.50", "7.50"), ("0.01", "0.01"), ("  3.25 ", "3.25"),
        ("9999999999999999.99", "9999999999999999.99"), ("0000000000000000012", "12.00"),
    ])
    func acceptsTheWebShape(input: String, expected: String) {
        for language in AppLanguage.allCases {
            #expect(parse(input, language)?.text == expected, "\(input) in \(language)")
        }
    }

    @Test(arguments: [
        "", "   ", "5.", ".", "1e3", "-5", "+5", "1 000", "$5", "5 USD", "1,234", "1,234.50", "1.234,50",
        "0", "0.00", ".00", "1.234", "9999999999999999.995", "10000000000000000", "10000000000000000.00",
        "٣.٥٠", "５.００", "1..5", "abc", "NaN", "1.2.3",
    ])
    func rejectsEverythingElse(input: String) {
        #expect(parse(input) == nil, "\(input)")
    }

    @Test func aDeviceKeyboardCommaWorksOnlyWhenTheDeviceUsesIt() {
        #expect(parse("12,5", .es, spain)?.text == "12.50")
        #expect(parse("12,50", .en, spain)?.text == "12.50")
        #expect(parse("12.50", .es, spain)?.text == "12.50")
        #expect(parse("12,5", .en, us) == nil)
        // Both separators in one amount are never accepted.
        #expect(parse("1.234,50", .en, spain) == nil)
        // A three-digit group is rejected, never read as thousands.
        #expect(parse("1,234", .en, spain) == nil)
    }

    @Test func largeValuesAreExactNotDouble() throws {
        let money = try #require(parse("9007199254740993.01")) // not representable as a Double
        #expect(money.text == "9007199254740993.01")
        #expect(money.cents == 900_719_925_474_099_301)
        #expect(money.decimal == Decimal(string: "9007199254740993.01", locale: Locale(identifier: "en_US_POSIX")))
    }

    @Test func maximumAndJustAbove() {
        #expect(parse("9999999999999999.99")?.cents == Money.maximumCents)
        #expect(parse("10000000000000000.00") == nil)
    }
}
