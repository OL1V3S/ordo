import Foundation
import Testing
@testable import Ordo

private let october = BudgetMonth(year: 2026, month: 10)!

private func parse(_ json: String, month: BudgetMonth = october) throws -> [BudgetLimitRow] {
    try BudgetLimitsValidation.parse(Data(json.utf8), month: month)
}

/// One row with a chosen raw `limitAmount` token.
private func row(limit token: String?, extra: String = "") -> String {
    let limit = token.map { ",\"limitAmount\":\($0)" } ?? ""
    return "[{\"id\":1,\"category\":\"food\",\"monthYear\":\"2026-10-01T00:00:00Z\"\(limit)\(extra)}]"
}

@Suite struct BudgetLimitsValidationTests {
    @Test func theFixtureDecodesAndTheOwnerIdIsIgnored() throws {
        let rows = try BudgetLimitsValidation.parse(try Fixtures.data("budgetlimits-october"), month: october)
        #expect(rows.map(\.id) == [11, 12, 13])
        #expect(rows.map(\.category) == ["food", "transport", "bills"])
        #expect(rows[0].limit == .exact(Money.parse("200.00")!))
        #expect(rows[1].limit == .exact(Money.parse("50.50")!))
        #expect(rows[2].limit == .exact(Money.parse("0.00", allowZero: true)!))
        // userId and user are not declared, so they are never decoded, stored, shown or logged.
        let printed = "\(rows[0]) \(String(reflecting: rows[0])) \(rows)"
        #expect(!printed.contains("synthetic-owner-id"))
        #expect(printed.contains("redacted"))
        #expect(!printed.contains("food") && !printed.contains("200"))
    }

    @Test func anEmptyArrayIsNoRows() throws {
        #expect(try BudgetLimitsValidation.parse(try Fixtures.data("budgetlimits-empty"), month: october).isEmpty)
    }

    @Test(arguments: [
        ("0.1", "0.10"), ("12.5", "12.50"), ("12.50", "12.50"), ("70368744177663.99", "70368744177663.99"),
        ("1e2", "100.00"), ("100", "100.00"), ("0", "0.00"), ("0.00", "0.00"), ("0.29", "0.29"),
        ("1234567890123.45", "1234567890123.45"), ("7E1", "70.00"), ("-0", "0.00"),
    ])
    func aJSONNumberIsReadExactly(token: String, expected: String) throws {
        let rows = try parse(row(limit: token))
        #expect(rows[0].limit == .exact(Money.parse(expected, allowZero: true)!))
    }

    @Test(arguments: [
        "\"12.50\"", "\"0\"", "null", "true", "false", "[]", "{}", "-1", "-0.01", "12.345", "0.001", "1e-7",
        "70368744177664", "70368744177664.00", "9999999999999999.99", "1234567890123456.78", "1e21", "1e400",
    ])
    func aLimitThatIsNotAnExactNumberNeedsReview(token: String) throws {
        let rows = try parse(row(limit: token))
        #expect(rows.count == 1 && rows[0].limit == .needsReview)
    }

    @Test func aMissingLimitNeedsReviewAndDoesNotFailTheResponse() throws {
        let rows = try parse(row(limit: nil))
        #expect(rows[0].limit == .needsReview)
    }

    @Test func oneBadLimitDoesNotHideTheOtherRows() throws {
        let json = """
        [{"id":1,"category":"food","monthYear":"2026-10-01","limitAmount":"12.50"},
         {"id":2,"category":"bills","monthYear":"2026-10-01","limitAmount":30}]
        """
        let rows = try parse(json)
        #expect(rows.map(\.limit) == [.needsReview, .exact(Money.parse("30.00")!)])
    }

    @Test(arguments: [
        "{}", "\"x\"", "7", "null", "", "[1]", "[null]", "[{}]",
        // id: missing, text, zero, negative, fractional, null
        #"[{"category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":"1","category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":0,"category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":-3,"category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":1.5,"category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":null,"category":"food","monthYear":"2026-10-01","limitAmount":1}]"#,
        // category: missing, null, number
        #"[{"id":1,"monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":1,"category":null,"monthYear":"2026-10-01","limitAmount":1}]"#,
        #"[{"id":1,"category":5,"monthYear":"2026-10-01","limitAmount":1}]"#,
        // monthYear: missing, null, number
        #"[{"id":1,"category":"food","limitAmount":1}]"#,
        #"[{"id":1,"category":"food","monthYear":null,"limitAmount":1}]"#,
        #"[{"id":1,"category":"food","monthYear":202610,"limitAmount":1}]"#,
    ])
    func aResponseThatIsNotAnArrayOfRowsIsMalformed(json: String) {
        #expect(throws: BudgetLimitsValidation.ParseError.malformed) { try parse(json) }
    }

    @Test(arguments: ["2026-11-01T00:00:00Z", "2026-09-30T22:00:00Z", "2025-10-01", "2026-1", "2026-100-01",
                      "2026-10x", "2026-10T00:00:00", "", "26-10-01", " 2026-10-01", "２０２６-10-01"])
    func aMonthThatIsNotTheRequestedOneIsMalformedAndNeverInferred(monthYear: String) {
        let json = #"[{"id":1,"category":"food","monthYear":"\#(monthYear)","limitAmount":1}]"#
        #expect(throws: BudgetLimitsValidation.ParseError.malformed) { try parse(json) }
    }

    @Test(arguments: ["2026-10-01T00:00:00Z", "2026-10-01T00:00:00", "2026-10-01T00:00:00.000Z", "2026-10-01", "2026-10",
                      "2026-10-31T23:59:59+00:00"])
    func theUsualMonthSpellingsBelongToTheRequestedMonth(monthYear: String) throws {
        let json = #"[{"id":1,"category":"food","monthYear":"\#(monthYear)","limitAmount":1}]"#
        #expect(try parse(json).count == 1)
    }

    @Test func oneRowOfAnotherMonthMakesTheWholeResponseMalformed() {
        let json = """
        [{"id":1,"category":"food","monthYear":"2026-10-01","limitAmount":1},
         {"id":2,"category":"bills","monthYear":"2026-11-01","limitAmount":1}]
        """
        #expect(throws: BudgetLimitsValidation.ParseError.malformed) { try parse(json) }
    }

    @Test func aBlankOrOddCategoryIsKeptAsStored() throws {
        let json = """
        [{"id":1,"category":"","monthYear":"2026-10-01","limitAmount":1},
         {"id":2,"category":"  Food  ","monthYear":"2026-10-01","limitAmount":2}]
        """
        let rows = try parse(json)
        #expect(rows.map(\.category) == ["", "  Food  "])
        #expect(rows[0].isBlankCategory && !rows[1].isBlankCategory)
    }

    @Test func theMonthPrefixCheckStopsAtTheEndOrADash() {
        #expect(BudgetLimitsValidation.belongs("2026-10", to: october))
        #expect(BudgetLimitsValidation.belongs("2026-10-", to: october))
        #expect(!BudgetLimitsValidation.belongs("2026-101", to: october))
        #expect(!BudgetLimitsValidation.belongs("2026-1", to: october))
    }

    @Test func theLargestSavedLimitIsTwoToTheFortySixthDollarsMinusOneCent() {
        #expect(BudgetLimitsValidation.maximumLimitCents == 7_036_874_417_766_399)
        #expect(BudgetLimitsValidation.limit(from: Decimal(string: "70368744177663.99", locale: Locale(identifier: "en_US_POSIX"))) == .exact(Money.parse("70368744177663.99")!))
        #expect(BudgetLimitsValidation.limit(from: Decimal(string: "70368744177664", locale: Locale(identifier: "en_US_POSIX"))) == .needsReview)
        #expect(BudgetLimitsValidation.limit(from: nil) == .needsReview)
    }
}
