import Foundation
import Testing
@testable import Ordo

private let english = BudgetsPresenter(l10n: L10n(language: .en))
private let spanish = BudgetsPresenter(l10n: L10n(language: .es))

private func food(limit: String? = "200.00") -> BudgetLimitRow { BudgetFixtures.row(id: 11, category: "food", limit: limit) }

private func card(_ presenter: BudgetsPresenter = english, used: BudgetSpending.Total, limit: String?,
                  spendingAvailable: Bool = true) -> BudgetsPresenter.Card {
    let row = food(limit: limit)
    return presenter.card(for: row, evaluation: BudgetRules.evaluate(spendingAvailable: spendingAvailable, used: used, limit: row.limit))
}

@Suite struct BudgetsPresentationTests {
    // MARK: Percent

    @Test(arguments: [(Int128(0), "0%"), (45, "45%"), (100, "100%"), (150, "150%"), (999, "999%"), (1_000, "1,000%"),
                      (1_234, "1,234%"), (1_234_567, "1,234,567%")])
    func aWholePercentIsGroupedAndHasNoSpaceBeforeTheSign(whole: Int128, expected: String) {
        #expect(BudgetsPresenter.percentText(whole, language: .en) == expected)
        #expect(BudgetsPresenter.percentText(whole, language: .es) == expected) // es-MX, as the web shows it
    }

    @Test func aHugePercentKeepsEveryDigit() {
        let whole = Int128(Money.maximumCents) * 100 // 99,999,999,999,999,999,900
        #expect(BudgetsPresenter.percentText(whole, language: .en) == "99,999,999,999,999,999,900%")
    }

    // MARK: Names

    @Test func knownCategoriesAreLocalizedWhateverTheirCaseAndPadding() {
        #expect(english.categoryName("food") == "Food" && spanish.categoryName("food") == "Comida")
        #expect(english.categoryName(" FOOD ") == "Food")
        #expect(english.categoryName("Bills") == "Bills" && spanish.categoryName("bills") == "Servicios")
        #expect(english.categoryName("other") == "Other" && spanish.categoryName("other") == "Otra")
        #expect(english.categoryName("uncategorized") == "Uncategorized" && spanish.categoryName("uncategorized") == "Sin categoría")
    }

    @Test func customCategoriesAreTitleCasedForDisplayOnly() {
        #expect(english.categoryName("eating out") == "Eating Out")
        #expect(english.categoryName("  pet    care ") == "Pet Care")
        #expect(english.categoryName("\u{e9}t\u{e9}") == "\u{c9}t\u{e9}")
        #expect(BudgetsPresenter.displayText("a b") == "A B")
        #expect(BudgetsPresenter.displayText("   ") == "")
    }

    @Test func aBlankCategoryIsShownAsStored() {
        #expect(english.categoryName("") == "")
        #expect(english.categoryName("   ") == "   ")
    }

    // MARK: Dates

    @Test func theNextResetDateIsAShortDateAndTheMonthLabelIsLocalized() {
        let october = BudgetMonth(year: 2026, month: 10)!
        #expect(english.nextResetDate(for: october) == "Nov 1, 2026")
        #expect(spanish.nextResetDate(for: october)?.contains("2026") == true)
        #expect(english.nextResetDate(for: BudgetMonth(year: 2026, month: 12)!) == "Jan 1, 2027")
        #expect(english.nextResetDate(for: .latest) == nil)
        #expect(english.monthLabel(october) == "October 2026" && spanish.monthLabel(october) == "octubre de 2026")
    }

    // MARK: Cards

    @Test func aWithinLimitCardSaysEverythingTheWebSays() {
        let result = card(used: .cents(5_000), limit: "200.00")
        #expect(result.name == "Food" && result.statusText == "Within limit")
        #expect(result.usedText == "$50.00" && result.usedOfText == "used of $200.00")
        #expect(result.percentUsedText == "25% used" && result.barTenths == 250 && result.note == nil && !result.warning)
        #expect(result.progressLabel == "Food budget used")
        #expect(result.progressValue == "$50.00 used of $200.00, 25%")
        #expect(result.accessibilityLabel == "Food budget, Within limit, $50.00 used of $200.00, 25%")
    }

    @Test func anOverLimitCardShowsThePercentUncappedAndTheBarFull() {
        let result = card(used: .cents(30_000), limit: "200.00")
        #expect(result.statusText == "Over limit" && result.percentUsedText == "150% used" && result.barTenths == 1000)
        #expect(result.warning)
        #expect(result.progressValue == "$300.00 used of $200.00, 150%")
    }

    @Test func aNearLimitCardIsAWarningWithABar() {
        let result = card(used: .cents(18_000), limit: "200.00")
        #expect(result.statusText == "Near limit" && result.warning && result.barTenths == 900)
    }

    @Test func aZeroLimitCardHasANoteAndNoBar() {
        let result = card(used: .cents(0), limit: "0.00")
        #expect(result.statusText == "Zero limit (no spending)" && result.warning)
        #expect(result.note == "No percentage for a zero limit." && result.percentUsedText == nil && result.barTenths == nil)
        #expect(result.usedOfText == "used of $0.00")
        #expect(result.accessibilityLabel == "Food budget, Zero limit (no spending), $0.00 used of $0.00, No percentage for a zero limit.")
    }

    @Test func anUnreadableAmountSaysUnavailableAndExplainsTheComparison() {
        let unreadableSpending = card(used: .needsReview, limit: "200.00")
        #expect(unreadableSpending.statusText == "Exact spending unavailable" && unreadableSpending.usedText == "Unavailable")
        #expect(unreadableSpending.usedOfText == "used of $200.00" && unreadableSpending.barTenths == nil)
        #expect(unreadableSpending.note == "Exact comparison is unavailable. Check the amount before relying on this budget status.")

        let unreadableLimit = card(used: .cents(100), limit: nil)
        #expect(unreadableLimit.statusText == "Exact limit unavailable" && unreadableLimit.usedText == "$1.00")
        #expect(unreadableLimit.usedOfText == "used of Unavailable" && unreadableLimit.note != nil)
    }

    @Test func whileSpendingIsUnavailableTheCardSaysSoWithoutAComparisonNote() {
        let result = card(used: .cents(100), limit: "200.00", spendingAvailable: false)
        #expect(result.statusText == "Spending unavailable" && result.usedText == "Unavailable" && result.note == nil)
        #expect(result.barTenths == nil && result.percentUsedText == nil)
    }

    @Test func theSpanishCardFollowsTheGlossary() {
        let result = card(spanish, used: .cents(5_000), limit: "200.00")
        #expect(result.name == "Comida" && result.statusText == "Dentro del límite")
        #expect(result.usedOfText.hasPrefix("usado de ") && result.usedOfText.contains("USD") && result.usedOfText.contains("200.00"))
        #expect(result.percentUsedText == "25% usado")
        #expect(result.accessibilityLabel.hasPrefix("Presupuesto de Comida, Dentro del límite"))
    }

    // MARK: Messages

    @Test func everyStatusAndFeedbackMessageIsLocalizedInBothLanguages() {
        for presenter in [english, spanish] {
            for status in BudgetStatus.allCases {
                #expect(presenter.l10n.hasTranslation(status.labelKey))
            }
            for feedback in [BudgetsViewModel.Feedback.saved, .savedRefreshFailed, .deleted, .deletedRefreshFailed, .unconfirmed, .refreshed] {
                #expect(presenter.l10n.hasTranslation(BudgetsPresenter.feedbackKey(feedback)))
            }
        }
        #expect(spanish.l10n.string(.budgetsFeedbackUnconfirmed).hasPrefix("No pudimos confirmar el cambio"))
    }

    @Test func theDeleteConfirmationNamesTheCategory() {
        #expect(english.confirmDeleteTitle(food()) == "Delete budget limit for category \"Food\"?")
        #expect(spanish.confirmDeleteTitle(food()) == "¿Eliminar el límite de presupuesto de la categoría \"Comida\"?")
        let custom = BudgetFixtures.row(id: 3, category: "pet care", limit: "1.00")
        #expect(english.confirmDeleteTitle(custom).contains("\"Pet Care\""))
    }

    @Test func monthAndCategoryAppearInTheFormAndStatusCopy() {
        let october = BudgetMonth(year: 2026, month: 10)!
        #expect(english.formHeading(.add) == "Add category budget")
        #expect(english.formHeading(.edit(food())) == "Edit Food budget")
        #expect(english.forMonth(october) == "For October 2026")
        #expect(spanish.forMonth(october) == "Para octubre de 2026")
        #expect(english.limitFieldLabel(.edit(food())) == "Monthly limit for Food" && english.limitFieldLabel(.add) == "Monthly limit")
        #expect(english.taskNote(month: october) == "Finish or cancel this October 2026 budget before changing months.")
        #expect(english.limitsError(month: october) == "We couldn’t load budget limits for October 2026. Refresh limits to try again.")
    }

    @Test func rowActionsAreNamedAfterTheCategory() {
        #expect(english.editActionLabel(food()) == "Edit Food budget")
        #expect(english.deleteActionLabel(food()) == "Delete Food budget")
        #expect(english.actionsLabel(food()) == "Actions for Food budget")
        #expect(spanish.editActionLabel(food()) == "Editar presupuesto de Comida")
    }

    @Test func theDeletingLabelReusesTheWebCatalogKey() {
        #expect(L10n(language: .en).string(.cashInDeleteDeleting) == "Deleting…")
        #expect(L10n(language: .es).string(.cashInDeleteDeleting) == "Eliminando…")
    }
}
