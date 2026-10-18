import Foundation
import Testing
@testable import Ordo

private func expenseJSON(_ overrides: [String: String] = [:], removing: [String] = []) -> String {
    var fields: [String: String] = [
        "kind": "\"expense\"", "recordId": "7", "date": "\"2026-10-17\"", "amount": "\"12.50\"",
        "description": "\"Synthetic lunch\"", "category": "\"Food\"", "paycheck": "null",
    ]
    for (key, value) in overrides { fields[key] = value }
    for key in removing { fields[key] = nil }
    return "{" + fields.map { "\"\($0.key)\": \($0.value)" }.sorted().joined(separator: ",") + "}"
}

private func depositJSON(_ overrides: [String: String] = [:]) -> String {
    var fields: [String: String] = [
        "kind": "\"account_inflow\"", "recordId": "9", "date": "\"2026-10-17\"", "amount": "\"20.00\"",
        "description": "\"Synthetic refund\"", "category": "null", "paycheck": "null",
    ]
    for (key, value) in overrides { fields[key] = value }
    return "{" + fields.map { "\"\($0.key)\": \($0.value)" }.sorted().joined(separator: ",") + "}"
}

private func pageJSON(items: [String], page: String = #"{"limit": 25, "hasMore": false, "nextCursor": null}"#,
                      currency: String = "USD") -> Data {
    Data(#"{"currencyCode": "\#(currency)", "items": [\#(items.joined(separator: ","))], "page": \#(page)}"#.utf8)
}

@Suite struct TimelineValidationTests {
    @Test func theFirstPageFixtureParses() throws {
        let page = try TimelineValidation.parse(try Fixtures.data("timeline-first-page"))
        #expect(page.items.count == 3)
        #expect(page.hasMore)
        #expect(page.nextCursor == "c3ludGhldGljLWN1cnNvcg")
        #expect(page.limit == 25)
        let deposit = page.items[0]
        #expect(deposit.kind == .accountInflow && deposit.paycheckLinked && deposit.category == nil)
        #expect(deposit.amount == .exact(Money.parse("1500.00")!))
        #expect(page.items[1].category == "Food")
        #expect(page.items[1].id == "expense:7")
    }

    @Test func theLastPageAndAnEmptyPageParse() throws {
        let last = try TimelineValidation.parse(try Fixtures.data("timeline-last-page"))
        #expect(!last.hasMore && last.nextCursor == nil && last.items.count == 1)
        let empty = try TimelineValidation.parse(try Fixtures.data("timeline-empty"))
        #expect(empty.items.isEmpty)
    }

    @Test func legacyAmountsDegradeOnlyTheirOwnRowAndKeepTheStoredText() throws {
        let page = try TimelineValidation.parse(try Fixtures.data("timeline-legacy-amounts"))
        #expect(page.items.map(\.amount) == [.needsReview("0.00"), .needsReview("-5.00"), .needsReview("-1.50")])
    }

    @Test(arguments: ["007.00", "10000000000000000.00", "00.50"])
    func storedAmountsThatAreNotExactStayUnrepaired(amount: String) throws {
        let page = try TimelineValidation.parse(pageJSON(items: [expenseJSON(["amount": "\"\(amount)\""])]))
        guard case .needsReview(let stored) = page.items[0].amount else {
            Issue.record("expected needsReview for \(amount)")
            return
        }
        #expect(stored == amount)
    }

    @Test(arguments: [
        #"{"limit": 25, "hasMore": true, "nextCursor": null}"#,
        #"{"limit": 25, "hasMore": true, "nextCursor": ""}"#,
        #"{"limit": 25, "hasMore": false, "nextCursor": "x"}"#,
        #"{"limit": 25, "hasMore": false}"#,
        #"{"limit": 0, "hasMore": false, "nextCursor": null}"#,
        #"{"limit": 101, "hasMore": false, "nextCursor": null}"#,
        #"{"limit": 2.5, "hasMore": false, "nextCursor": null}"#,
        #"{"limit": 25, "hasMore": "false", "nextCursor": null}"#,
        #"{"hasMore": false, "nextCursor": null}"#,
    ]) func aBadPageEnvelopeIsMalformed(page: String) {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(pageJSON(items: [expenseJSON()], page: page))
        }
    }

    @Test func moreItemsThanTheLimitIsMalformed() {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(pageJSON(items: [expenseJSON(), depositJSON()],
                                                   page: #"{"limit": 1, "hasMore": false, "nextCursor": null}"#))
        }
    }

    @Test(arguments: ["EUR", "usd", ""])
    func aCurrencyOtherThanUSDIsMalformed(currency: String) {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(pageJSON(items: [], currency: currency))
        }
    }

    @Test(arguments: [
        ["kind": "\"transfer\""],
        ["recordId": "0"], ["recordId": "-3"], ["recordId": "1.5"], ["recordId": "\"7\""], ["recordId": "null"],
        ["date": "\"2026-02-30\""], ["date": "\"2026-1-05\""], ["date": "\"0000-01-01\""], ["date": "\"2026-10-17T00:00:00\""],
        ["date": "20261017"], ["date": "null"],
        ["amount": "12.5"], ["amount": "\"12.5\""], ["amount": "\"12\""], ["amount": "\"+12.50\""],
        ["amount": "\"1,200.00\""], ["amount": "\"١٢.٥٠\""], ["amount": "null"],
        ["description": "7"], ["description": "null"],
        ["category": "null"], ["category": "5"],
        ["paycheck": "{\"profileId\": \"p\", \"relation\": \"recorded_receipt\"}"],
    ] as [[String: String]])
    func aBadExpenseRowMakesTheWholePageMalformed(overrides: [String: String]) {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(pageJSON(items: [depositJSON(), expenseJSON(overrides)]))
        }
    }

    @Test func aMissingKeyOnAnExpenseIsMalformed() {
        for key in ["kind", "recordId", "date", "amount", "description", "category", "paycheck"] {
            #expect(throws: TimelineValidation.ParseError.malformed, "\(key)") {
                try TimelineValidation.parse(pageJSON(items: [expenseJSON(removing: [key])]))
            }
        }
    }

    @Test func theExpensePaycheckKeyMustBePresentAsNull() throws {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(try Fixtures.data("timeline-missing-paycheck-key"))
        }
    }

    @Test func anEmptyPaycheckProfileIdIsMalformed() throws {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(try Fixtures.data("timeline-empty-profile-id"))
        }
    }

    @Test(arguments: [
        ["category": "\"Food\""],
        ["paycheck": "\"linked\""],
        ["paycheck": "{\"profileId\": \"p\", \"relation\": \"unknown\"}"],
        ["paycheck": "{\"profileId\": 5, \"relation\": \"recorded_receipt\"}"],
        ["paycheck": "{\"relation\": \"recorded_receipt\"}"],
    ] as [[String: String]])
    func aBadDepositRowMakesTheWholePageMalformed(overrides: [String: String]) {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(pageJSON(items: [expenseJSON(), depositJSON(overrides)]))
        }
    }

    @Test func bothPaycheckRelationsAreAccepted() throws {
        for relation in ["confirmation_evidence", "recorded_receipt"] {
            let paycheck = "{\"profileId\": \"p\", \"relation\": \"\(relation)\"}"
            let page = try TimelineValidation.parse(pageJSON(items: [depositJSON(["paycheck": paycheck])]))
            #expect(page.items[0].paycheckLinked)
        }
    }

    @Test(arguments: ["", "[]", "null", "{", "\"text\""])
    func nonObjectBodiesAreMalformed(body: String) {
        #expect(throws: TimelineValidation.ParseError.malformed) {
            try TimelineValidation.parse(Data(body.utf8))
        }
    }

    @Test func anUnknownExtraKeyIsIgnored() throws {
        let page = try TimelineValidation.parse(pageJSON(items: [expenseJSON(["extra": "1"])]))
        #expect(page.items.count == 1)
    }

    @Test func descriptionsKeepTheirCaseAndSpacing() throws {
        let page = try TimelineValidation.parse(pageJSON(items: [expenseJSON(["description": "\"  MiXed Case  \""])]))
        #expect(page.items[0].descriptionText == "  MiXed Case  ")
    }

    @Test func descriptionsAndAmountsAreRedactedWhenPrinted() throws {
        let page = try TimelineValidation.parse(try Fixtures.data("timeline-first-page"))
        let item = page.items[1]
        for text in [String(describing: item), String(reflecting: item), "\(item)"] {
            #expect(!text.contains("Synthetic") && !text.contains("12.50") && !text.contains("7"))
        }
    }
}
