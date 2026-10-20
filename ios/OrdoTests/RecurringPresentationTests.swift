import Foundation
import Testing
@testable import Ordo

@MainActor @Suite struct RecurringPresentationTests {
    private let en = RecurringPresenter(l10n: L10n(language: .en))
    private let es = RecurringPresenter(l10n: L10n(language: .es))

    @Test func timingSummariesFollowTheWeb() {
        #expect(en.timingSummary(RecurringFixtures.timing()) == "Day 15, up to 1 day early or 2 days late")
        #expect(en.timingSummary(RecurringFixtures.timing(before: 0, after: 1)) == "Day 15, up to 0 days early or 1 day late")
        #expect(en.timingSummary(RecurringFixtures.timing("weekly", kind: "weekday", weekday: "friday", day: nil)) == "Friday, up to 1 day early or 2 days late")
        #expect(en.timingSummary(RecurringFixtures.timing(kind: "monthend", day: nil)) == "Month end, up to 1 day early or 2 days late")
        #expect(en.timingSummary(RecurringFixtures.timing("yearly", kind: "monthandday", day: 3, month: 4)) == "Month 4, day 3, up to 1 day early or 2 days late")
    }

    @Test func spanishTimingSummariesUseTheSpanishCopy() {
        #expect(es.timingSummary(RecurringFixtures.timing()) == "Día 15, hasta 1 día antes o 2 días después")
        #expect(es.timingSummary(RecurringFixtures.timing(kind: "monthend", day: nil)) == "Fin de mes, hasta 1 día antes o 2 días después")
        #expect(es.timingSummary(RecurringFixtures.timing("weekly", kind: "weekday", weekday: "monday", day: nil)).hasPrefix("Lunes,"))
    }

    @Test func amountSummaries() {
        #expect(en.amount(.fixed(.exact(Money.parse("1200.25")!))) == "$1,200.25")
        #expect(es.amount(.fixed(.exact(Money.parse("1200.25")!))).hasPrefix("USD"))
        #expect(en.amount(.range(minimum: .exact(Money.parse("10.00")!), maximum: .exact(Money.parse("14.50")!))) == "$10.00–$14.50")
        #expect(en.amount(.fixed(.needsReview)) == "Exact amount unavailable")
        #expect(en.amount(.unavailable) == "Exact amount unavailable")
        #expect(en.observedAmount(RecurringFixtures.candidate(fixed: false)) == "$10.00–$14.50")
    }

    @Test func unknownWireValuesUseTheTitleFallback() {
        #expect(en.cadence("every_other_week") == "Every other week")
        #expect(en.weekday("noday") == "Noday")
        #expect(en.evidenceRule("some_new_rule") == "Some new rule")
        #expect(RecurringPresenter.title("camelCaseValue") == "Camel Case Value")
        #expect(en.source("whatever") == "Added manually" && en.source("sunflower_pdf") == "Sunflower statement")
    }

    @Test func categoryAndCadenceLabels() {
        #expect(en.categoryAndCadence(category: "bills", cadence: "monthly") == "Bills · Monthly")
        #expect(en.categoryAndCadence(category: "Gym", cadence: "yearly") == "Gym · Yearly")
    }

    @Test func lifecycleActionSetsFollowTheWeb() {
        #expect(RecurringViewModel.actions(for: .active) == [.pause, .end])
        #expect(RecurringViewModel.actions(for: .paused) == [.reactivate, .end])
        #expect(RecurringViewModel.actions(for: .ended) == [.reactivate, .pause])
    }

    @Test func pluralsAndCounts() {
        #expect(en.linkedExpenses(1) == "1 linked expense" && en.linkedExpenses(2) == "2 linked expenses")
        #expect(en.basedOn(RecurringFixtures.candidate()) == "Based on 3 expenses")
    }

    @Test func errorCodesMapAndUnknownIsGeneric() {
        #expect(RecurringPresenter.errorKey("candidate_changed") == .commitmentsFeedbackErrorsCandidateChanged)
        #expect(RecurringPresenter.errorKey("commitment_not_found") == .commitmentsFeedbackErrorsCommitmentNotFound)
        #expect(RecurringPresenter.errorKey("anything") == .commitmentsFeedbackErrorsRequestFailed)
        #expect(RecurringPresenter.errorKey(nil) == .commitmentsFeedbackErrorsRequestFailed)
    }

    @Test func accessibilitySummariesNameTheExpectedAmount() {
        let summary = en.accessibilitySummary(RecurringFixtures.commitment())
        #expect(summary.contains("Expected amount: $1,200.25") && summary.contains("Synthetic Rent"))
    }

    @Test func redactionHidesPersonalText() {
        let text = "\(RecurringFixtures.candidate()) \(RecurringFixtures.commitment()) \(RecurringFixtures.evidence())"
            + " \(CommitmentWrite(operation: .dismiss(fingerprint: RecurringFixtures.fp1, body: Data()))) \(ConfirmDraft.initial(for: RecurringFixtures.candidate()))"
        #expect(!text.contains("Synthetic") && !text.contains(RecurringFixtures.fp1) && !text.contains("12.34"))
        #expect(String(reflecting: RecurringFixtures.commitment()).contains("redacted"))
    }
}
