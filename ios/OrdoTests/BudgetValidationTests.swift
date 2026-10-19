import Foundation
import Testing
@testable import Ordo

private let october = BudgetMonth(year: 2026, month: 10)!
private let english = Locale(identifier: "en_US")
private let german = Locale(identifier: "de_DE")

private func limit(_ text: String, device: Locale = english, language: AppLanguage = .en) -> Money? {
    BudgetValidation.limit(text, language: language, deviceLocale: device)
}

private func draft(_ choice: BudgetCategoryChoice?, custom: String = "", amount: String = "10") -> BudgetDraft {
    var value = BudgetDraft()
    value.choice = choice
    value.customCategory = custom
    value.amountText = amount
    return value
}

@Suite struct BudgetValidationTests {
    // MARK: Limit

    @Test(arguments: [("12.5", "12.50"), ("12", "12.00"), ("0", "0.00"), ("0.00", "0.00"), (".5", "0.50"), ("007", "7.00"),
                      ("70368744177663.99", "70368744177663.99"), ("  9.99  ", "9.99")])
    func aLimitOfZeroOrMoreWithAtMostTwoDecimalsIsAccepted(text: String, expected: String) {
        #expect(limit(text)?.text == expected)
    }

    @Test(arguments: ["", "   ", "-5", "-0", "+5", "5.123", "5.", "1e3", "abc", "1,234", "1 234", "$5", "5%", "١٢",
                      "70368744177664", "70368744177664.00", "99999999999999.99", "9999999999999999.99", "0.001"])
    func blankNegativeOverPreciseOrOversizedLimitsAreRejected(text: String) {
        #expect(limit(text) == nil)
    }

    @Test func theSeparatorFollowsTheLocaleAndGroupingIsNeverStripped() {
        #expect(limit("12.5", language: .es)?.text == "12.50") // es_MX uses "."
        #expect(limit("12,5", device: german)?.text == "12.50") // a keyboard with a comma separator
        #expect(limit("12,5", device: english) == nil)
        #expect(limit("1,234", device: english) == nil)
        #expect(limit("1.234,5", device: german) == nil)
    }

    @Test func theCapKeepsEveryRequestInsideTheDatabaseRange() {
        #expect(BudgetLimitsValidation.maximumLimitCents / 100 < 70_368_744_177_664)
        #expect(limit("70368744177663.99")?.cents == BudgetLimitsValidation.maximumLimitCents)
    }

    // MARK: Add: the category

    @Test(arguments: [BudgetCategoryChoice.food, .transport, .bills, .entertainment])
    func aFixedChoiceSendsItsLowercaseKey(choice: BudgetCategoryChoice) {
        #expect(BudgetValidation.addCategory(draft(choice)) == choice.rawValue)
        #expect(BudgetValidation.addCategory(draft(choice, custom: "ignored text")) == choice.rawValue)
    }

    @Test func noChoiceIsRejected() {
        #expect(BudgetValidation.addCategory(draft(nil)) == nil)
    }

    @Test func customTextIsTrimmedCollapsedAndLowercased() {
        #expect(BudgetValidation.addCategory(draft(.other, custom: "  Eating   OUT \n today ")) == "eating out today")
        #expect(BudgetValidation.addCategory(draft(.other, custom: "Pets")) == "pets")
        #expect(BudgetValidation.addCategory(draft(.other, custom: "Caf\u{e9}")) == "caf\u{e9}")
    }

    @Test(arguments: ["", "   ", "\n\t "])
    func aBlankCustomCategorySendsUncategorized(text: String) {
        #expect(BudgetValidation.addCategory(draft(.other, custom: text)) == "uncategorized")
    }

    @Test(arguments: ["other", "Other", "  OTHER  ", "oTHer"])
    func otherIsNeverSent(text: String) {
        #expect(BudgetValidation.addCategory(draft(.other, custom: text)) == nil)
        if case .failure(let failure) = BudgetValidation.add(draft(.other, custom: text), month: october, language: .en, deviceLocale: english) {
            #expect(failure.fields == [.customCategory])
        } else {
            Issue.record("expected a failure")
        }
    }

    @Test func aCategoryIsLimitedToOneHundredCharactersAndNeverTruncated() {
        let hundred = String(repeating: "a", count: 100)
        #expect(BudgetValidation.addCategory(draft(.other, custom: hundred)) == hundred)
        #expect(BudgetValidation.addCategory(draft(.other, custom: hundred + "a")) == nil)
        // Lengths are UTF-16 code units, as .NET and JavaScript count them.
        #expect(BudgetValidation.addCategory(draft(.other, custom: String(repeating: "\u{1F355}", count: 50))) != nil)
        #expect(BudgetValidation.addCategory(draft(.other, custom: String(repeating: "\u{1F355}", count: 51))) == nil)
        // The limit is on the normalized value: collapsed whitespace does not count.
        #expect(BudgetValidation.addCategory(draft(.other, custom: hundred + "      ")) == hundred)
    }

    // MARK: Add and Edit as a whole

    @Test func aValidAddFreezesTheCategoryTheLimitAndTheSelectedMonth() throws {
        let result = BudgetValidation.add(draft(.food, amount: "12.5"), month: october, language: .en, deviceLocale: english)
        let upsert = try result.get()
        #expect(upsert == BudgetUpsert(category: "food", limit: Money.parse("12.50")!, month: october))
    }

    @Test func aZeroLimitIsAValidAdd() throws {
        let upsert = try BudgetValidation.add(draft(.bills, amount: "0"), month: october, language: .en, deviceLocale: english).get()
        #expect(upsert.limit.text == "0.00" && upsert.limit.cents == 0)
    }

    @Test func eachInvalidFieldIsReportedAndTheCategoryComesFirst() {
        let both = BudgetValidation.add(draft(nil, amount: ""), month: october, language: .en, deviceLocale: english)
        guard case .failure(let failure) = both else { Issue.record("expected a failure"); return }
        #expect(failure.fields == [.category, .amount] && failure.first == .category)

        let amountOnly = BudgetValidation.add(draft(.food, amount: "-1"), month: october, language: .en, deviceLocale: english)
        guard case .failure(let second) = amountOnly else { Issue.record("expected a failure"); return }
        #expect(second.fields == [.amount] && second.first == .amount)
    }

    @Test func anEditKeepsTheStoredCategoryVerbatim() throws {
        for stored in ["  Food  ", "FOOD", "Food", "caf\u{e9} \"x\"", "other"] {
            let upsert = try BudgetValidation.edit(storedCategory: stored, amountText: "75", month: october,
                                                   language: .en, deviceLocale: english).get()
            #expect(upsert.category == stored)
            #expect(upsert.limit.text == "75.00")
        }
    }

    @Test func anEditAcceptsZeroAndRejectsTheSameBadLimitsAsAnAdd() throws {
        #expect(try BudgetValidation.edit(storedCategory: "food", amountText: "0", month: october, language: .en, deviceLocale: english).get().limit.cents == 0)
        for bad in ["", "-1", "1.234", "x", "70368744177664"] {
            if case .success = BudgetValidation.edit(storedCategory: "food", amountText: bad, month: october, language: .en, deviceLocale: english) {
                Issue.record("accepted \(bad)")
            }
        }
    }

    @Test(arguments: ["", "  ", "\u{a0}"])
    func aBlankStoredCategoryCanNeverBeEdited(stored: String) {
        let result = BudgetValidation.edit(storedCategory: stored, amountText: "10", month: october, language: .en, deviceLocale: english)
        guard case .failure(let failure) = result else { Issue.record("expected a failure"); return }
        #expect(failure.fields.contains(.category))
    }

    @Test func draftsAndUpsertsAreRedactedWhenPrinted() {
        let value = draft(.other, custom: "synthetic-secret", amount: "123.45")
        #expect("\(value)" == "BudgetDraft(redacted)")
        let upsert = BudgetUpsert(category: "synthetic-secret", limit: Money.parse("1.00")!, month: october)
        #expect("\(upsert)" == "BudgetUpsert(redacted)" && String(reflecting: upsert) == "BudgetUpsert(redacted)")
        let write = BudgetWrite(operation: .upsert(upsert))
        #expect("\(write)" == "BudgetWrite(redacted)" && String(reflecting: write) == "BudgetWrite(redacted)")
    }
}
