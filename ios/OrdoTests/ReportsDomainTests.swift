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
        let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        var users: [String] = []
        // The app, the code it shares with the widget, and the widget.
        for folder in ["Ordo", "Shared", "OrdoWidget"] {
            let root = ios.appendingPathComponent(folder, isDirectory: true)
            let enumerator = try #require(FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil))
            for case let url as URL in enumerator where url.pathExtension == "swift" {
                if try String(contentsOf: url, encoding: .utf8).contains("approximateDollars") { users.append(url.lastPathComponent) }
            }
        }
        // Chart geometry only: the four charts.
        #expect(users.sorted() == ["CashAmount.swift", "CashFlowCategoriesSection.swift", "CashFlowCategoryTrendSection.swift",
                                    "CashFlowPaceSection.swift", "CashFlowTrendSection.swift"])
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

    @Test func validDaysAndCategoriesDecodeExactly() throws {
        let report = try parse(ReportsFixtures.json(selected: ReportsFixtures.fullMonthJSON()))
        #expect(report.selected.days.count == 31 && report.selected.days[9].spent.canonical == "9000")
        #expect(report.selected.days[9].date.isoString == "2026-10-10")
        #expect(report.selected.categories.map(\.category) == ["food", "transport"])
        #expect("\(report.selected.days[0])".contains("redacted"))
    }

    @Test func absentDaysAndCategoriesAreEmpty() throws {
        let report = try parse(ReportsFixtures.json())
        #expect(report.selected.days.isEmpty && report.selected.categories.isEmpty)
    }

    @Test func malformedDaysAndCategoriesFailAsAWhole() {
        func full(days: [Int: String] = [3: "1000", 10: "9000"], spent: String = "10000",
                  categories: String = #"[{"category":"food","amountMinor":"9000"},{"category":"transport","amountMinor":"1000"}]"#) -> String {
            ReportsFixtures.json(selected: ReportsFixtures.fullMonthJSON(spent: spent, dayAmounts: days, categories: categories))
        }
        let good = ReportsFixtures.fullMonthJSON()
        let cases: [String] = [
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #"{"date":"2026-10-05","#, with: #"{"date":"2026-10-04","#)), // duplicate
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #"{"date":"2026-10-05","spentMinor":"0"},"#, with: "")), // gap
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #"{"date":"2026-10-31","spentMinor":"0"}"#, with: #"{"date":"2026-11-01","spentMinor":"0"}"#)), // out of range
            ReportsFixtures.json(selected: good.replacingOccurrences(of: #",{"date":"2026-10-31","spentMinor":"0"}"#, with: "")), // stops short of `to`
            full(days: [3: "-1000", 10: "11000"]), // negative day
            full(days: [3: "1000.0", 10: "9000"]), // bad string
            full(days: [3: "1000", 10: "8000"]), // days do not sum to Spent
            full(categories: #"[{"category":"food","amountMinor":"9000"},{"category":"food","amountMinor":"1000"}]"#), // repeated
            full(categories: #"[{"category":"food","amountMinor":"9000"},{"category":"x","amountMinor":"0"}]"#), // not positive
            full(categories: #"[{"category":"food","amountMinor":"9000"},{"category":"x","amountMinor":"900"}]"#), // sum mismatch
            ReportsFixtures.json(selected: ReportsFixtures.monthJSON(days: "[]")), // present but empty
        ]
        for (index, text) in cases.enumerated() {
            #expect(throws: CashFlowValidationError.malformed, "case \(index)") { try parse(text) }
        }
    }

    @Test func overflowingSumsAreMalformed() {
        // Two categories that sum past Int128 while each parses.
        let huge = "100000000000000000000000000000000000000"
        let categories = #"[{"category":"a","amountMinor":"\#(huge)"},{"category":"b","amountMinor":"\#(huge)"}]"#
        let categoryOverflow = ReportsFixtures.json(selected: ReportsFixtures.fullMonthJSON(spent: huge, dayAmounts: [1: huge], categories: categories))
        #expect(throws: CashFlowValidationError.malformed) { try parse(categoryOverflow) }
        // Two months whose Spent values overflow when added.
        let a = ReportsFixtures.monthJSON("2026-09", spent: huge)
        let b = ReportsFixtures.monthJSON("2026-10", spent: huge)
        let monthsOverflow = ReportsFixtures.json(selected: b, months: [a, b, a, b])
        #expect(throws: CashFlowValidationError.malformed) { try parse(monthsOverflow) }
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

    private func category(_ name: String, _ amount: String) -> CashFlowCategory {
        CashFlowCategory(category: name, amount: CashAmount(amount)!)
    }

    @Test func sharesFollowTheListOrderAndSum() {
        let list = [category("b", "500"), category("a", "500"), category("c", "900")]
        let shares = ReportsPresenter.categoryShares(list, spent: CashAmount("1900")!)
        #expect(shares.map(\.category) == ReportsPresenter.ordered(list).map(\.category))
        #expect(shares.map(\.amount) == ReportsPresenter.ordered(list).map(\.amount))
        #expect(shares.allSatisfy { !$0.isOther })
    }

    @Test func sharesAreEmptyWithoutSpendingOrCategories() {
        #expect(ReportsPresenter.categoryShares([category("a", "5")], spent: CashAmount("0")!).isEmpty)
        #expect(ReportsPresenter.categoryShares([], spent: CashAmount("100")!).isEmpty)
        #expect(ReportsPresenter.categoryShares([category("a", "5")], spent: CashAmount("5")!).count == 1)
    }

    @Test func sevenCategoriesGroupTheTailIntoAnExactOther() {
        let six = (1...6).map { category("c\($0)", String($0)) }
        #expect(ReportsPresenter.categoryShares(six, spent: CashAmount("21")!).count == 6)
        let seven = six + [category("c7", "99999999999999999999")]
        let shares = ReportsPresenter.categoryShares(seven, spent: CashAmount("1000")!)
        #expect(shares.count == 6)
        #expect(shares[5].isOther && shares[5].count == 2 && shares[5].amount.canonical == "3")
        #expect(shares[0].amount.canonical == "99999999999999999999")
    }

    @Test func donutAndNetKeysExistInBothLanguages() {
        #expect(L10n(language: .en).string(.analyticsChartDatasetsNet) == "Deposits minus spending")
        #expect(L10n(language: .es).string(.analyticsChartDatasetsNet) == "Depósitos menos gastos")
        #expect(L10n(language: .en).string(.analyticsCategoriesDonutOther, "2") == "Other (2)")
        #expect(L10n(language: .es).string(.analyticsCategoriesDonutOther, "2") == "Resto (2)")
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

@Suite struct ReportsTrendPresentationTests {
    private func month(_ json: String) throws -> CashFlowMonth {
        try CashFlowValidation.parse(ReportsFixtures.data(ReportsFixtures.json(selected: json)),
                                     month: ReportsFixtures.october, throughDate: ReportsFixtures.through).selected
    }

    @Test func cumulativeDaysStayExactAboveInt64() throws {
        let big = "9223372036854775808"
        let bucket = try month(ReportsFixtures.fullMonthJSON(spent: "9223372036854775810", dayAmounts: [1: big, 2: "2"],
                                                            categories: "[]"))
        let points = ReportsPresenter.cumulativeDays(bucket)
        #expect(points.count == 31 && points[0].cumulative.canonical == big)
        #expect(points[1].cumulative.canonical == "9223372036854775810" && points[30].cumulative.canonical == "9223372036854775810")
        #expect(points[1].day == 2)
    }

    @Test func previousMonthIsNilAtTheFloor() throws {
        let bucket = try month(ReportsFixtures.fullMonthJSON())
        #expect(ReportsPresenter.previousMonth([bucket]) == nil)
        #expect(ReportsPresenter.previousMonth([bucket, bucket]) == bucket)
    }

    @Test func categoryTrendGroupsSevenCategoriesIntoFiveAndOther() throws {
        let rows = (1...7).map { #"{"category":"c\#($0)","amountMinor":"\#((8 - $0) * 100)"}"# }.joined(separator: ",")
        let bucket = try month(ReportsFixtures.fullMonthJSON(spent: "2800", dayAmounts: [1: "2800"], categories: "[\(rows)]"))
        let series = ReportsPresenter.categoryTrend([bucket])
        #expect(series.count == 6 && series[0].category == "c1" && series[0].amounts[0].canonical == "700")
        #expect(series[5].isOther && series[5].count == 2 && series[5].amounts[0].canonical == "300")
        #expect(ReportsPresenter.categoryTrend([]).isEmpty)
        let empty = try month(ReportsFixtures.monthJSON())
        #expect(ReportsPresenter.categoryTrend([empty]).isEmpty)
    }
}
