import Testing
@testable import Ordo

@Suite struct PlanSectionTests {
    @Test func sectionsFollowTheWebPlanOrder() {
        #expect(PlanSection.allCases == [.budgets, .recurring, .paychecks])
    }

    @Test func labelsMatchTheWebInEnglish() {
        let l10n = L10n(language: .en)
        #expect(PlanSection.allCases.map { l10n.string($0.labelKey) } == ["Budgets", "Recurring expenses", "Paychecks"])
        #expect(l10n.string(.navigationDestinationsPlan) == "Plan")
        #expect(l10n.string(.navigationHubsPlanAriaLabel) == "Budgets, recurring expenses, and paychecks")
    }

    @Test func labelsMatchTheWebInSpanish() {
        let l10n = L10n(language: .es)
        #expect(PlanSection.allCases.map { l10n.string($0.labelKey) } == ["Presupuestos", "Gastos recurrentes", "Nómina"])
        #expect(l10n.string(.navigationHubsPlanAriaLabel) == "Presupuestos, gastos recurrentes y nómina")
    }

    @Test func sectionsHaveDistinctIds() {
        #expect(Set(PlanSection.allCases.map(\.id)).count == PlanSection.allCases.count)
    }
}
