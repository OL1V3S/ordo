import Foundation
import Testing
@testable import Ordo

@Suite struct EditPrefillTests {
    private func draft(category: String?, amount: TimelineAmount = .exact(Money.parse("12.50")!),
                       description: String = "Synthetic Lunch") -> CaptureDraft {
        TransactionsPresenter.editDraft(for: TimelineFixtures.item(amount: amount, description: description, category: category))
    }

    // MARK: Category

    @Test(arguments: [
        ("food", CategoryChoice.food), ("Food", .food), ("  TRANSPORT ", .transport), ("Bills", .bills),
        ("Entertainment", .entertainment), ("uncategorized", .uncategorized), ("Uncategorized", .uncategorized),
    ])
    func aKnownStoredCategoryIsTrimmedAndLowercasedBeforeMatching(stored: String, expected: CategoryChoice) {
        let result = draft(category: stored)
        #expect(result.category == expected)
        #expect(result.customCategory == "")
    }

    @Test(arguments: ["Groceries", "Pet supplies", "custom", "Custom"])
    func anyOtherStoredCategoryBecomesCustomWithTheStoredText(stored: String) {
        let result = draft(category: stored)
        #expect(result.category == .custom)
        #expect(result.customCategory == stored)
    }

    @Test func aLegacyOtherIsPrefilledAsCustomAndRejectedLocally() {
        let result = draft(category: "other")
        #expect(result.category == .custom && result.customCategory == "other")
        let validated = CaptureValidation.validateValues(result, kind: .expense, language: .en,
                                                         deviceLocale: TimelineFixtures.english)
        #expect(validated == .failure(CaptureValidation.Failure(fields: [.category])))
    }

    @Test func anEmptyStoredCategoryIsCustomEmptyAndSavesAsUncategorized() throws {
        let result = draft(category: "")
        #expect(result.category == .custom && result.customCategory == "")
        let values = try CaptureValidation.validateValues(result, kind: .expense, language: .en,
                                                          deviceLocale: TimelineFixtures.english).get()
        #expect(values.category == "uncategorized")
    }

    @Test func aCapitalisedLegacyCategorySavesNormalised() throws {
        let values = try CaptureValidation.validateValues(draft(category: "Food"), kind: .expense, language: .en,
                                                          deviceLocale: TimelineFixtures.english).get()
        #expect(values.category == "food")
        let custom = try CaptureValidation.validateValues(draft(category: "Pet  Supplies"), kind: .expense,
                                                          language: .en, deviceLocale: TimelineFixtures.english).get()
        #expect(custom.category == "pet supplies")
    }

    // MARK: Other fields

    @Test func theDescriptionAndDateArePrefilledVerbatim() {
        let item = TimelineFixtures.item(date: "2026-02-28", description: "  MiXed Case  ")
        let result = TransactionsPresenter.editDraft(for: item)
        #expect(result.description == "  MiXed Case  ")
        #expect(result.date.isoString == "2026-02-28")
    }

    @Test func aDepositHasNoCategory() {
        let result = TransactionsPresenter.editDraft(for: TimelineFixtures.item(.accountInflow, id: 3))
        #expect(result.category == .uncategorized && result.customCategory == "")
    }

    @Test func theAmountThatNeedsReviewIsLeftEmpty() {
        for stored in ["0.00", "-5.00", "007.00"] {
            #expect(draft(category: "food", amount: .needsReview(stored)).amountText == "")
        }
    }

    // MARK: Exact money

    @Test(arguments: ["12.50", "0.01", "1234567.89", "9999999999999999.99", "9007199254740993.01", "0.10"])
    func theAmountRoundTripsExactlyThroughTheForm(text: String) throws {
        let money = try #require(Money.parse(text))
        let result = draft(category: "food", amount: .exact(money))
        #expect(result.amountText == text)
        for language in AppLanguage.allCases {
            let parsed = try #require(AmountInput.parse(result.amountText, language: language,
                                                        deviceLocale: TimelineFixtures.english))
            #expect(parsed == money)
            #expect(parsed.text == text)
        }
        let values = try CaptureValidation.validateValues(result, kind: .expense, language: .es,
                                                          deviceLocale: Locale(identifier: "es_MX")).get()
        #expect(values.amount == text)
    }

    @Test func aLargeValueWouldLoseDigitsAsADouble() throws {
        let text = "9007199254740993.01"
        #expect(String(Double(text)!) != text) // the reason amounts are never Double
        #expect(try #require(Money.parse(text)).decimal == Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")))
    }

    // MARK: Actionability

    @Test func anExpenseThatNeedsReviewHasDeleteOnlyAndADepositCanAlwaysBeEdited() {
        let review = TimelineAmount.needsReview("0.00")
        #expect(!TransactionsPresenter.canEdit(TimelineFixtures.item(.expense, amount: review)))
        #expect(TransactionsPresenter.canEdit(TimelineFixtures.item(.accountInflow, amount: review)))
        #expect(TransactionsPresenter.canEdit(TimelineFixtures.item(.expense)))
        #expect(TransactionsPresenter.canEdit(TimelineFixtures.item(.accountInflow, linked: true)))
    }

    // MARK: Presentation

    @Test func rowsShowSignedAmountsAndTheStoredTextWhenTheAmountNeedsReview() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .en))
        #expect(presenter.amountText(TimelineFixtures.item(.expense)) == "−$12.50")
        #expect(presenter.amountText(TimelineFixtures.item(.accountInflow)) == "+$12.50")
        let review = TimelineFixtures.item(.expense, amount: .needsReview("-5.00"))
        #expect(presenter.amountText(review) == "Exact amount unavailable")
        #expect(presenter.storedAmountText(review) == "-5.00")
        #expect(presenter.storedAmountText(TimelineFixtures.item()) == nil)
    }

    @Test func theActionLabelsNameTheRecordAndItsNumberLikeTheWeb() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .en))
        let item = TimelineFixtures.item(id: 42, date: "2026-10-17", description: "Synthetic lunch")
        #expect(presenter.editActionLabel(item) == "Edit expense Synthetic lunch, Oct 17, 2026 (number 42)")
        #expect(presenter.deleteActionLabel(item) == "Delete expense Synthetic lunch, Oct 17, 2026 (number 42)")
        let deposit = TimelineFixtures.item(.accountInflow, id: 5, description: "Synthetic refund")
        #expect(presenter.editActionLabel(deposit).hasPrefix("Edit deposit Synthetic refund"))
    }

    @Test func theDeleteHeadingNamesTheRecordForBothKinds() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .en))
        let expense = TimelineFixtures.item(.expense, description: "Synthetic lunch")
        #expect(presenter.deleteHeading(expense) == "Delete expense: Synthetic lunch (Oct 17, 2026)?")
        #expect(presenter.deleteMessage(expense) == nil)
        let deposit = TimelineFixtures.item(.accountInflow, description: "Synthetic refund")
        #expect(presenter.deleteHeading(deposit) == "Delete deposit: Synthetic refund (Oct 17, 2026)?")
        let message = presenter.deleteMessage(deposit) ?? ""
        #expect(message.contains("pay schedule") && message.contains("importing the same statement"))
    }

    @Test func spanishActionLabelsAndHeadingsAreLocalised() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .es))
        let item = TimelineFixtures.item(id: 42, description: "Synthetic lunch")
        #expect(presenter.editActionLabel(item).hasPrefix("Editar gasto Synthetic lunch"))
        #expect(presenter.editActionLabel(item).hasSuffix("(número 42)"))
        #expect(presenter.deleteHeading(item).hasPrefix("¿Eliminar gasto: Synthetic lunch"))
    }

    @Test func theFilterSummaryListsEachSetFilter() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .en))
        var filter = TimelineFilter()
        filter.q = " lunch "
        filter.kind = .accountInflow
        filter.from = CalendarDate("2026-10-01")
        filter.to = CalendarDate("2026-10-17")
        let text = presenter.filterSummary(filter)
        #expect(text == "Active filters: Search: “lunch” · Deposit · From Oct 1, 2026 · Through Oct 17, 2026")
    }

    @Test func spanishRowDatesAndKindsUseTheSpanishFormat() {
        let presenter = TransactionsPresenter(l10n: L10n(language: .es))
        let item = TimelineFixtures.item(.accountInflow, id: 1, date: "2026-10-17", category: nil)
        #expect(presenter.kindLabel(item.kind) == "Depósito")
        #expect(presenter.amountText(item).hasPrefix("+USD"))
    }
}
