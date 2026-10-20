import Foundation
import Testing
@testable import Ordo

@Suite struct CashAmountTests {
    @Test func parsesTheCanonicalGrammarExactly() {
        for text in ["0", "5", "-1500", "9007199254740993", "9223372036854775808", "99999999999999999999",
                     "-99999999999999999999"] {
            #expect(CashAmount(text)?.canonical == text, "\(text)")
        }
    }

    @Test func valuesAbove2Pow53AndInt64AreNotRounded() throws {
        let aboveDouble = try #require(CashAmount("9007199254740993"))
        #expect(aboveDouble.value == 9_007_199_254_740_993)
        #expect(Double(9_007_199_254_740_993) == 9_007_199_254_740_992) // a Double would lose the cent
        let aboveInt64 = try #require(CashAmount("99999999999999999999"))
        #expect(aboveInt64.value > Int128(Int64.max) && aboveInt64.canonical == "99999999999999999999")
        #expect(aboveInt64 > aboveDouble)
        #expect(CashAmount("9223372036854775808")! > CashAmount("9223372036854775807")!)
    }

    @Test(arguments: ["-0", "01", "+5", "1.00", " 5", "5 ", "1e3", "", "-", "٣", "１２", "0x10", "1,000", "--5",
                      "170141183460469231731687303715884105728", "999999999999999999999999999999999999999999"])
    func rejectsEveryOtherForm(_ text: String) {
        #expect(CashAmount(text) == nil, "\(text)")
    }

    @Test func comparesAndClassifiesWithoutConversion() {
        #expect(CashAmount("-1")! < CashAmount("0")! && CashAmount("0")!.isZero)
        #expect(CashAmount("-1500")!.isNegative && CashAmount("-1500")!.magnitude == 1500)
    }

    @Test func printsNothingPrivate() {
        let amount = CashAmount("123456")!
        #expect(!"\(amount)".contains("123456") && !String(reflecting: amount).contains("123456"))
        let report = ReportsFixtures.report()
        for text in ["\(report)", "\(report.selected)", "\(report.categories[0])", String(reflecting: report)] {
            #expect(text.contains("redacted") && !text.contains("15000") && !text.contains("food"))
        }
    }

    @Test func approximateDollarsIsUsedOnlyByTheChart() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Ordo", isDirectory: true)
        let enumerator = try #require(FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil))
        var users: [String] = []
        for case let url as URL in enumerator where url.pathExtension == "swift" {
            if try String(contentsOf: url, encoding: .utf8).contains("approximateDollars") { users.append(url.lastPathComponent) }
        }
        #expect(users.sorted() == ["CashAmount.swift", "CashFlowTrendSection.swift"])
    }
}

@Suite struct CashFlowValidationTests {
    private func parse(_ text: String, month: BudgetMonth = ReportsFixtures.october,
                       through: CalendarDate = ReportsFixtures.through) throws -> CashFlowReport {
        try CashFlowValidation.parse(ReportsFixtures.data(text), month: month, throughDate: through)
    }

    @Test func aFullResponseDecodesWithTheExactStrings() throws {
        let report = try parse(ReportsFixtures.json())
        #expect(report.month == ReportsFixtures.october && report.throughDate == ReportsFixtures.through)
        #expect(report.availableMonths == [ReportsFixtures.october, ReportsFixtures.september])
        #expect(report.selected.cashIn.canonical == "15000" && report.selected.net.canonical == "5000")
        #expect(report.selected.paycheckProfileCount == 1 && report.categories.map(\.category) == ["food", "transport"])
    }

    @Test func hugeAndNegativeAmountsStayExact() throws {
        let text = ReportsFixtures.json(selected: ReportsFixtures.monthJSON(cashIn: "99999999999999999999",
            paycheck: "9007199254740993", other: "90992000000000006", spent: "100000000000000000000", net: "-1"))
        let report = try parse(text)
        #expect(report.selected.cashIn.canonical == "99999999999999999999" && report.selected.net.canonical == "-1")
        #expect(report.selected.paycheckCashIn.canonical == "9007199254740993")
    }

    @Test func theCalendarFloorGivesFewerMonths() throws {
        let floor = BudgetMonth(year: 1, month: 2)!
        let text = ReportsFixtures.json(month: "0001-02", through: "0001-02-15", available: ["0001-02"],
                                        selected: ReportsFixtures.monthJSON("0001-02", to: "0001-02-15"),
                                        months: [ReportsFixtures.monthJSON("0001-01"), ReportsFixtures.monthJSON("0001-02", to: "0001-02-15")],
                                        categories: "[]")
        let report = try parse(text, month: floor, through: CalendarDate("0001-02-15")!)
        #expect(report.months.count == 2 && report.categories.isEmpty)
    }

    @Test func unknownKeysAreIgnored() throws {
        _ = try parse(ReportsFixtures.json(extra: #","futureKey":{"a":1}"#))
    }

    @Test func malformedResponsesFailAsAWhole() {
        let good = ReportsFixtures.monthJSON()
        let cases: [String] = [
            ReportsFixtures.json(selected: ReportsFixtures.monthJSON(cashIn: "15000.00")),
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #""cashInMinor":"15000""#, with: #""cashInMinor":15000"#)),
            ReportsFixtures.json(selected: ReportsFixtures.monthJSON(net: "-0")),
            ReportsFixtures.json(selected: ReportsFixtures.monthJSON(spent: "01")),
            ReportsFixtures.json(available: ["2026-13"]),
            ReportsFixtures.json(available: ["2026-1"]),
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #""from":"2026-10-01""#, with: #""from":"2026-10-1""#)),
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #""expenseCount":2"#, with: #""expenseCount":-1"#)),
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #""expenseCount":2"#, with: #""expenseCount":2.5"#)),
            ReportsFixtures.json(months: []),
            ReportsFixtures.json(categories: #"[{"category":"food","amountMinor":9000}]"#),
            ReportsFixtures.json(categories: #"[{"category":"food","amountMinor":"x"}]"#),
            ReportsFixtures.json(selected: ReportsFixtures.monthJSON("2026-09")), // selected is another month
            #"{"month":"2026-10"}"#, "[]", "not json", "",
            ReportsFixtures.json().replacingOccurrences(of: #""selected":"#, with: #""other":"#),
        ]
        for (index, text) in cases.enumerated() {
            #expect(throws: CashFlowValidationError.malformed, "case \(index)") { try parse(text) }
        }
    }

    @Test func aResponseForAnotherPeriodFails() {
        let september = ReportsFixtures.json(month: "2026-09", through: "2026-10-20")
        #expect(throws: CashFlowValidationError.malformed) { try parse(september) }
        let otherDay = ReportsFixtures.json(through: "2026-10-21")
        #expect(throws: CashFlowValidationError.malformed) { try parse(otherDay) }
    }
}

@Suite struct ReportsPresentationTests {
    private func cash(_ text: String, _ language: AppLanguage = .en, signed: Bool = false) -> String {
        ReportsFormatter(language: language).cash(CashAmount(text)!, signed: signed)
    }

    private func percent(_ part: String, _ whole: String, _ language: AppLanguage = .en) -> String? {
        ReportsFormatter(language: language).percentage(CashAmount(part)!, of: CashAmount(whole)!)
    }

    @Test func moneyMatchesTheWebStringsByteForByte() {
        #expect(cash("-1500") == "\u{2212}$15.00")
        #expect(cash("-1500", .es) == "\u{2212}USD\u{a0}15.00")
        #expect(cash("5000", .es, signed: true) == "+USD\u{a0}50.00")
        #expect(cash("99999999999999999999") == "$999,999,999,999,999,999.99")
        #expect(cash("0") == "$0.00" && cash("1") == "$0.01" && cash("-1") == "\u{2212}$0.01")
        #expect(cash("999999999999999999") == "$9,999,999,999,999,999.99")
        #expect(cash("2999999999999999997") == "$29,999,999,999,999,999.97")
        #expect(cash("99999999999999999999", .es) == "USD\u{a0}999,999,999,999,999,999.99")
        #expect(cash("9007199254740993") == "$90,071,992,547,409.93")
    }

    @Test func signedOnlyMarksPositiveAndNegative() {
        #expect(cash("100", signed: true) == "+$1.00")
        #expect(cash("-100", signed: true) == "\u{2212}$1.00")
        #expect(cash("0", signed: true) == "$0.00")
        #expect(cash("100") == "$1.00")
    }

    @Test(arguments: AppLanguage.allCases)
    func agreesWithMoneyFormatterWhereTheAmountFitsMoney(_ language: AppLanguage) {
        let existing = MoneyFormatter(language: language, currencyCode: "USD")
        for text in ["0.01", "1.00", "15.00", "1234.56", "999999.99", "1000000.00", "12345678.90"] {
            let money = Money.parse(text)!
            let cents = text.replacingOccurrences(of: ".", with: "")
            let trimmed = String(Int(cents)!)
            #expect(cash(trimmed, language) == existing.string(money), "\(text) \(language)")
        }
    }

    @Test func percentagesRoundHalvesUpAndStayUngrouped() {
        #expect(percent("1", "3") == "33.3%" && percent("1", "3", .es) == "33.3%")
        #expect(percent("12345", "1000") == "1234.5%")
        #expect(percent("1", "16") == "6.3%")
        #expect(percent("151", "100") == "151.0%")
        #expect(percent("999999999999999999", "1") == "99999999999999999900.0%")
        #expect(percent("0", "100") == "0.0%")
        #expect(percent("1", "2000") == "0.1%" && percent("1", "2001") == "0.0%")
        #expect(percent("100", "0") == nil && percent("0", "0") == nil && percent("1", "-5") == nil)
    }

    @Test func anUnrepresentableShareIsNotApplicable() {
        let huge = CashAmount(Int128.max)
        #expect(ReportsFormatter(language: .en).percentage(huge, of: CashAmount("1")!) == nil)
    }

    @Test func barFractionIsZeroWhenTheMaximumIsNotPositive() {
        let part = CashAmount("100")!
        #expect(ReportsFormatter.barFraction(part, of: CashAmount("0")!) == 0)
        #expect(ReportsFormatter.barFraction(part, of: CashAmount("-5")!) == 0)
        #expect(ReportsFormatter.barFraction(CashAmount("12000")!, of: CashAmount("30000")!) == 0.4)
        #expect(ReportsFormatter.barFraction(CashAmount("3000")!, of: CashAmount("30000")!) == 0.1)
        #expect(ReportsFormatter.barFraction(CashAmount("30000")!, of: CashAmount("30000")!) == 1)
        #expect(ReportsFormatter.barFraction(CashAmount("0")!, of: CashAmount("0")!) == 0)
    }

    @Test func monthAndDateLabelsUseTheWebCatalog() {
        let en = ReportsPresenter(l10n: L10n(language: .en)), es = ReportsPresenter(l10n: L10n(language: .es))
        let march = BudgetMonth(year: 2026, month: 3)!, jan50 = BudgetMonth(year: 50, month: 1)!
        #expect(en.monthLabel(march) == "March 2026" && es.monthLabel(march) == "marzo de 2026")
        #expect(en.monthLabel(jan50) == "January 0050")
        #expect(en.monthLabel(BudgetMonth(year: 9999, month: 12)!, short: true) == "Dec 9999")
        #expect(en.monthLabel(BudgetMonth.earliest) == "January 0001")
        #expect(en.dateLabel(CalendarDate("2024-02-29")!) == "February 29, 2024")
        #expect(en.dateLabel(CalendarDate("0001-01-01")!) == "January 1, 0001")
        #expect(es.dateLabel(CalendarDate("2026-10-20")!) == "20 de octubre de 2026")
        #expect(en.tickParts(march) == ("Mar", "2026"))
    }

    @Test func periodNotesAreFactualOnly() {
        let en = ReportsPresenter(l10n: L10n(language: .en)), es = ReportsPresenter(l10n: L10n(language: .es))
        func bucket(_ month: String, to: String, cashIn: String, spent: String) -> CashFlowMonth {
            let text = ReportsFixtures.json(month: month, selected: ReportsFixtures.monthJSON(month, to: to, cashIn: cashIn, spent: spent))
            return try! CashFlowValidation.parse(ReportsFixtures.data(text), month: BudgetMonth(key: month)!,
                                                 throughDate: ReportsFixtures.through).selected
        }
        let through = ReportsFixtures.through
        #expect(en.periodNotes(bucket("2026-10", to: "2026-10-20", cashIn: "0", spent: "0"), throughDate: through)
                == "Through October 20, 2026 · No deposits recorded · No spending recorded")
        #expect(es.periodNotes(bucket("2026-10", to: "2026-10-20", cashIn: "0", spent: "0"), throughDate: through)
                == "Hasta el 20 de octubre de 2026 · No hay depósitos registrados · No hay gastos registrados")
        #expect(en.periodNotes(bucket("2026-09", to: "2026-09-30", cashIn: "100", spent: "100"), throughDate: through) == "—")
        #expect(en.periodNotes(bucket("2026-09", to: "2026-09-30", cashIn: "100", spent: "0"), throughDate: through)
                == "No spending recorded")
    }

    @Test func theTrendKickerShowsTheCountAndStartAtTheFloor() {
        let en = ReportsPresenter(l10n: L10n(language: .en)), es = ReportsPresenter(l10n: L10n(language: .es))
        #expect(en.trendKicker(monthCount: 6) == "Six calendar months" && es.trendKicker(monthCount: 6) == "Seis meses calendario")
        #expect(en.trendKicker(monthCount: 2) == "2 calendar months from January 0001")
        #expect(en.trendKicker(monthCount: 1) == "1 calendar month from January 0001")
        #expect(es.trendKicker(monthCount: 2) == "2 meses calendario desde enero de 0001")
        #expect(es.trendKicker(monthCount: 1) == "1 mes calendario desde enero de 0001")
    }

    /// Pairs and signs taken from the web's `localeCompare(…, "en")`.
    @Test(arguments: [("a", "B", -1), ("Food", "food", 1), ("a-b", "ab", -1), ("10", "9", -1), ("_a", "a", -1),
                      ("Z", "a", 1), ("é", "f", -1), ("e", "é", -1), ("a b", "ab", -1), ("a.b", "a-b", 1),
                      ("Gym", "gym", 1), ("#1", "1", -1), ("Ñ", "N", 1)] as [(String, String, Int)])
    func equalAmountsFollowTheWebCollation(_ left: String, _ right: String, _ sign: Int) {
        let amount = CashAmount("500")!
        let sorted = ReportsPresenter.ordered([CashFlowCategory(category: right, amount: amount),
                                               CashFlowCategory(category: left, amount: amount)])
        #expect(sorted.map(\.category) == (sign < 0 ? [left, right] : [right, left]), "\(left) vs \(right)")
    }

    @Test func categoriesRankByExactAmountFirst() {
        let list = [CashFlowCategory(category: "a", amount: CashAmount("9007199254740992")!),
                    CashFlowCategory(category: "b", amount: CashAmount("9007199254740993")!),
                    CashFlowCategory(category: "c", amount: CashAmount("99999999999999999999")!)]
        #expect(ReportsPresenter.ordered(list).map(\.category) == ["c", "b", "a"])
    }

    @Test func monthOptionsListCurrentSelectedAndAvailableNewestFirst() {
        let m = { (y: Int, mo: Int) in BudgetMonth(year: y, month: mo)! }
        let options = ReportsPresenter.monthOptions(current: m(2026, 10), selected: m(2026, 7),
                                                    available: [m(2026, 9), m(2026, 7), m(2026, 3)])
        #expect(options == [m(2026, 10), m(2026, 9), m(2026, 7), m(2026, 3)])
        #expect(ReportsPresenter.neighbor(of: m(2026, 9), in: options, direction: -1) == m(2026, 7))
        #expect(ReportsPresenter.neighbor(of: m(2026, 9), in: options, direction: 1) == m(2026, 10))
        #expect(ReportsPresenter.neighbor(of: m(2026, 10), in: options, direction: 1) == nil)
        #expect(ReportsPresenter.neighbor(of: m(2026, 3), in: options, direction: -1) == nil)
    }

    @Test func everyAnalyticsKeyIsLocalizedWithoutBackslashPlaceholders() {
        for language in AppLanguage.allCases {
            let l10n = L10n(language: language)
            for key in L10nKey.allCases where key.rawValue.hasPrefix("analytics.") {
                #expect(!l10n.string(key).contains("{{"), "\(key.rawValue)")
            }
        }
        #expect(L10n(language: .es).string(.analyticsSummaryNetHeading) == "Depósitos menos gastos")
        #expect(L10n(language: .es).string(.analyticsSummaryConfirmedPaychecks) == "Pagos de nómina confirmados")
        #expect(L10n(language: .en).string(.navigationDestinationsInsights) == "Reports")
    }
}
