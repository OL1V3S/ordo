import Foundation
import Testing
@testable import Ordo

@Suite struct PaycheckSlotsTests {
    @MainActor @Test func slotsAreOfferedOnlyForActiveSchedulesWithSlots() {
        #expect(PaycheckFixtures.profile().canLinkDeposit)
        #expect(!PaycheckFixtures.profile(lifecycle: .paused).canLinkDeposit)
        #expect(!PaycheckFixtures.profile(lifecycle: .ended).canLinkDeposit)
        #expect(!PaycheckFixtures.profile(slots: []).canLinkDeposit)
    }

    @Test func labelsNameCurrentAndPrevious() {
        let presenter = PaychecksPresenter(l10n: L10n(language: .en))
        #expect(presenter.slotLabel(PaycheckFixtures.slot(.current)) == "Current: Oct 15, 2026–Oct 18, 2026")
        #expect(presenter.slotLabel(PaycheckFixtures.slot(.previous), stale: true).hasSuffix("(previously selected)"))
        #expect(presenter.slotLabel(PaycheckFixtures.slot(.previous)).hasPrefix("Previous: "))
    }

    @MainActor @Test func slotsAreShownVerbatimNeverComputedLocally() async {
        // A slot that does not fit the schedule at all is still exactly what is offered.
        let odd = PaycheckFixtures.slot(.current, anchor: "2031-02-03", from: "2031-02-01", to: "2031-02-04")
        let service = ScriptedPaychecksService(loads: [{ PaycheckFixtures.snapshot([PaycheckFixtures.profile(slots: [odd])]) }])
        let model = await PaycheckFixtures.loaded(service)
        model.beginReceipt(model.snapshot!.profiles[0])
        #expect(model.selectedSlot == odd)
        #expect(model.receipt?.draft.slotAnchor == odd.anchor)
    }

    @MainActor @Test func aStaleSelectionDisablesLinkAndNeverSends() async {
        let first = PaycheckFixtures.profile()
        let service = ScriptedPaychecksService(loads: [{ PaycheckFixtures.snapshot([first]) },
                                                       { PaycheckFixtures.snapshot([PaycheckFixtures.profile(slots: [PaycheckFixtures.slot(.current, anchor: "2026-10-30", from: "2026-10-29", to: "2026-11-01")])]) }])
        let model = await PaycheckFixtures.loaded(service)
        model.beginReceipt(first)
        #expect(!model.isSlotStale)
        await model.refresh()
        #expect(model.isSlotStale)
        #expect(model.receipt?.rememberedSlot?.anchor == PaycheckFixtures.date("2026-10-16"))
        model.submitReceipt()
        await model.settled()
        #expect(service.writes.isEmpty)
    }
}

@Suite struct PaycheckLinkableDepositsTests {
    private let deposits = [PaycheckFixtures.deposit(1, "Alpha Pay"), PaycheckFixtures.deposit(2, "beta bonus"),
                            PaycheckFixtures.deposit(3, "Gamma"), PaycheckFixtures.deposit(4, "ALPHA refund")]

    @Test func depositsClaimedByAnyScheduleAreExcluded() {
        let snapshot = PaycheckFixtures.snapshot([
            PaycheckFixtures.profile(PaycheckFixtures.id1, evidence: [PaycheckFixtures.evidence(1)]),
            PaycheckFixtures.profile(PaycheckFixtures.id2, lifecycle: .paused, evidence: [PaycheckFixtures.evidence(2)]),
        ])
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: snapshot, search: "").map(\.id) == [3, 4])
    }

    @Test func aDepositClaimedOnlyByAnEndedSchedulesConfirmationEvidenceIsExcluded() {
        let snapshot = PaycheckFixtures.snapshot([
            PaycheckFixtures.profile(PaycheckFixtures.id1),
            PaycheckFixtures.profile(PaycheckFixtures.id2, lifecycle: .ended, evidence: [PaycheckFixtures.evidence(3, kind: .confirmationEvidence)]),
        ])
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: snapshot, search: "").map(\.id) == [1, 2, 4])
    }

    @Test func searchIsCaseInsensitiveTrimmedAndKeepsServerOrder() {
        let snapshot = PaycheckFixtures.snapshot()
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: snapshot, search: "  alpha ").map(\.id) == [1, 4])
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: snapshot, search: "zzz").isEmpty)
    }

    @Test func theClaimedSetIsRecomputedFromTheNewestRead() {
        let before = PaycheckFixtures.snapshot([PaycheckFixtures.profile(evidence: [PaycheckFixtures.evidence(1)])])
        let after = PaycheckFixtures.snapshot([PaycheckFixtures.profile()])
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: before, search: "").count == 3)
        #expect(LinkableDeposits.list(deposits: deposits, snapshot: after, search: "").count == 4)
    }
}

@Suite struct ReceiptDraftTests {
    private func parse(_ draft: ReceiptDraft, language: AppLanguage = .en, locale: Locale = TimelineFixtures.english) -> Result<(description: String, amount: Money), ReceiptValidation.Failure> {
        ReceiptValidation.validateNew(draft, language: language, deviceLocale: locale)
    }

    @Test func defaultsUseTheNameTheExactFixedAmountAndTheDeviceToday() {
        let draft = ReceiptDraft.initial(for: PaycheckFixtures.profile(), today: PaycheckFixtures.date("2026-10-20"))
        #expect(draft.descriptionText == "Synthetic Employer" && draft.amountText == "1200.25")
        #expect(draft.date == PaycheckFixtures.date("2026-10-20") && draft.slotAnchor == PaycheckFixtures.date("2026-10-16"))
        #expect(draft.source == .new)
        for amount in [PaycheckAmount.fixed(.needsReview), .range(minimum: .exact(Money.parse("1.00")!), maximum: .exact(Money.parse("2.00")!)), .unavailable] {
            #expect(ReceiptDraft.initial(for: PaycheckFixtures.profile(amount: amount), today: PaycheckFixtures.date("2026-10-20")).amountText.isEmpty)
        }
    }

    @Test(arguments: ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"])
    func todayFollowsTheDeviceCalendarInAnyTimeZone(zone: String) {
        let now = TimelineFixtures.fixedNow
        let expected = DateFormatting.localCalendarDate(now: now, timeZone: TimeZone(identifier: zone)!)
        let draftDay = DateFormatting.localCalendarDate(now: now, timeZone: TimeZone(identifier: zone)!)
        #expect(ReceiptDraft.initial(for: PaycheckFixtures.profile(), today: draftDay).date == expected)
    }

    @Test func validation() {
        var draft = ReceiptDraft.initial(for: PaycheckFixtures.profile(), today: PaycheckFixtures.date("2026-10-20"))
        if case .success(let values) = parse(draft) { #expect(values.amount.text == "1200.25" && values.description == "Synthetic Employer") } else { Issue.record("valid draft failed") }
        draft.descriptionText = "   "
        #expect(failure(parse(draft)) == [.description])
        draft.descriptionText = String(repeating: "a", count: 500); #expect(isSuccess(parse(draft)))
        draft.descriptionText = String(repeating: "a", count: 501); #expect(failure(parse(draft)) == [.description])
        draft.descriptionText = "ok"
        for bad in ["", "0", "0.00", "1.234", "-1", "10000000000000000.00", "1,234.00", "abc"] {
            draft.amountText = bad
            #expect(failure(parse(draft)) == [.amount], "\(bad)")
        }
        draft.amountText = "9999999999999999.99"; #expect(isSuccess(parse(draft)))
        draft.amountText = "12,5"
        #expect(isSuccess(parse(draft, language: .es, locale: Locale(identifier: "de_DE"))))
        draft.descriptionText = "  Pay  "
        draft.amountText = "5"
        if case .success(let values) = parse(draft) { #expect(values.description == "Pay" && values.amount.text == "5.00") }
    }

    private func failure(_ result: Result<(description: String, amount: Money), ReceiptValidation.Failure>) -> Set<ReceiptField>? {
        if case .failure(let failure) = result { return failure.fields }
        return nil
    }

    private func isSuccess(_ result: Result<(description: String, amount: Money), ReceiptValidation.Failure>) -> Bool {
        if case .success = result { return true }
        return false
    }

    private func warnings(_ profile: PaycheckProfile, amount: PaycheckMoney?, date: String) -> [ReceiptWarning] {
        ReceiptValidation.warnings(profile: profile, slot: PaycheckFixtures.slot(), amount: amount, date: PaycheckFixtures.date(date))
    }

    @Test func warningsAreAdvisoryAndExact() {
        let fixed = PaycheckFixtures.profile()
        func exact(_ text: String) -> PaycheckMoney { .exact(Money.parse(text)!) }
        #expect(warnings(fixed, amount: exact("1200.25"), date: "2026-10-15").isEmpty)
        #expect(warnings(fixed, amount: exact("1200.25"), date: "2026-10-18").isEmpty)
        #expect(warnings(fixed, amount: exact("1200.25"), date: "2026-10-14") == [.dateOutsideWindow])
        #expect(warnings(fixed, amount: exact("1200.25"), date: "2026-10-19") == [.dateOutsideWindow])
        #expect(warnings(fixed, amount: exact("1200.26"), date: "2026-10-16") == [.differsFromFixed])
        #expect(warnings(fixed, amount: nil, date: "2026-10-16").isEmpty)
        #expect(warnings(fixed, amount: .needsReview, date: "2026-10-16") == [.amountNeedsReview])
        #expect(warnings(PaycheckFixtures.profile(amount: .fixed(.needsReview)), amount: exact("1.00"), date: "2026-10-16") == [.expectedAmountNeedsReview])
        let range = PaycheckFixtures.profile(amount: .range(minimum: exact("100.00"), maximum: exact("200.00")))
        #expect(warnings(range, amount: exact("100.00"), date: "2026-10-16").isEmpty)
        #expect(warnings(range, amount: exact("200.00"), date: "2026-10-16").isEmpty)
        #expect(warnings(range, amount: exact("99.99"), date: "2026-10-16") == [.outsideRange])
        #expect(warnings(range, amount: exact("200.01"), date: "2026-10-16") == [.outsideRange])
        let badRange = PaycheckFixtures.profile(amount: .range(minimum: .needsReview, maximum: exact("2.00")))
        #expect(warnings(badRange, amount: exact("1.00"), date: "2026-10-16") == [.expectedRangeNeedsReview])
    }
}
