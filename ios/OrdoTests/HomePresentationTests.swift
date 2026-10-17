import Foundation
import Testing
@testable import Ordo

@Suite struct HomePresentationTests {
    private func budget(_ category: String, _ state: BudgetAttentionItem.State, _ spent: String, _ limit: String) -> BudgetAttentionItem {
        BudgetAttentionItem(category: category, state: state, spent: Money.parse(spent)!, limit: Money.parse(limit, allowZero: true)!)
    }
    private let commitment = CommitmentAttentionItem(id: "3f1c2a54-9a7e-4c1d-8b0e-0a1b2c3d4e5f", name: "Plan",
                                                     reviews: [ReviewReason(dimension: .amount, state: "proposed_change")])

    @Test func attentionOrderAndCap() {
        let content = AttentionContent(
            commitmentItems: [commitment],
            budgetItems: [budget("Bills", .atLimit, "10.00", "10.00"), budget("Food", .overLimit, "20.00", "10.00")],
            isPartial: false)
        let rows = HomePresenter.attentionRows(content)
        #expect(rows.count == 2)
        #expect(rows[0] == .budget(budget("Food", .overLimit, "20.00", "10.00")))
        #expect(rows[1] == .commitment(commitment))
    }

    @Test func atLimitComesLast() {
        let content = AttentionContent(commitmentItems: [],
                                       budgetItems: [budget("Bills", .atLimit, "10.00", "10.00"),
                                                     budget("Zoo", .zeroLimitSpending, "5.00", "0.00")], isPartial: false)
        let rows = HomePresenter.attentionRows(content)
        #expect(rows.first == .budget(budget("Zoo", .zeroLimitSpending, "5.00", "0.00")))
    }

    @Test func categoryMappingIsCaseInsensitiveAndTrimmed() {
        let en = L10n(language: .en), es = L10n(language: .es)
        #expect(CategoryLabel.label(for: "Food", l10n: es) == "Comida")
        #expect(CategoryLabel.label(for: " food ", l10n: en) == "Food")
        #expect(CategoryLabel.label(for: nil, l10n: es) == "Sin categoría")
        #expect(CategoryLabel.label(for: "Coffee Beans", l10n: es) == "Coffee Beans")
    }

    @Test func reasonsAreJoinedWithTheWebSeparator() throws {
        let item = CommitmentAttentionItem(id: commitment.id, name: "Plan", reviews: [
            ReviewReason(dimension: .amount, state: "proposed_change"),
            ReviewReason(dimension: .missing, state: "possibly_ended")])
        let presenter = HomePresenter(l10n: L10n(language: .en), currencyCode: "USD")
        #expect(presenter.detail(for: .commitment(item)) == "Amount change to review; Check if this recurring expense is still active")
    }

    @Test func activityAmountsCarrySigns() throws {
        let home = try Fixtures.snapshot("home-all-available")
        guard case .available(let items) = home.recentActivity else { Issue.record("recent"); return }
        let presenter = HomePresenter(l10n: L10n(language: .en), currencyCode: "USD")
        #expect(presenter.amount(for: items[1]) == "+$1,234.56")
        #expect(presenter.amount(for: items[2]) == "−$4.75")
    }

    @Test func budgetTextUsesMoneyFormatting() {
        let presenter = HomePresenter(l10n: L10n(language: .es), currencyCode: "USD")
        let text = presenter.detail(for: .budget(budget("Food", .overLimit, "120.50", "100.00")))
        #expect(text.contains("120.50") && text.contains("100.00") && text.contains("USD"))
    }
}
