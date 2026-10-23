import Foundation
import Testing
@testable import Ordo

@Suite struct ConfirmDraftTests {
    private let en = TimelineFixtures.english

    private func draft(_ candidate: RecurringCandidate = RecurringFixtures.candidate()) -> ConfirmDraft { ConfirmDraft.initial(for: candidate) }

    private func fields(_ draft: ConfirmDraft, language: AppLanguage = .en) -> Set<ConfirmField> {
        if case .failure(let failure) = draft.validate(language: language, deviceLocale: en) { return failure.fields }
        return []
    }

    @Test func aFixedCandidatePrefillsTheExactMedian() {
        let d = draft()
        #expect(d.name == "Synthetic Streaming" && d.category == "bills" && d.cadence == .monthly)
        #expect(d.amountMode == .fixed && d.expectedText == "12.34" && d.dayText == "15" && d.beforeText == "1" && d.afterText == "2")
        #expect(!d.observedUnsafe && fields(d).isEmpty)
    }

    @Test func aVariableCandidatePrefillsTheRange() {
        let d = draft(RecurringFixtures.candidate(fixed: false, median: "12.00"))
        #expect(d.amountMode == .range && d.expectedText == "" && d.minimumText == "10.00" && d.maximumText == "14.50")
    }

    @Test func unknownCadenceIsMonthlyAndMissingWeekdayIsMonday() {
        let odd = RecurringFixtures.candidate(timing: RecurringFixtures.timing("daily", kind: "weekday", weekday: "noday", day: nil))
        let d = draft(odd)
        #expect(d.cadence == .monthly && d.weekday == "monday")
    }

    @Test func switchingCadenceResetsTimingLikeTheWeb() {
        var d = draft()
        d.setCadence(.weekly)
        #expect(d.weekday == "monday" && d.dayText == "" && d.monthText == "")
        d.setCadence(.yearly)
        #expect(d.dayText == "1" && d.monthText == "1")
        d.dayText = "9"; d.monthText = "5"
        d.setCadence(.monthly)
        #expect(d.dayText == "9" && d.monthText == "" && d.monthlyTiming == .dayofmonth)
        d.setCadence(.weekly); d.weekday = "friday"; d.setCadence(.weekly)
        #expect(d.weekday == "friday")
    }

    @Test func anUnreadableObservedAmountBlocksConfirmAndPrefillsNothing() {
        var fixed = RecurringFixtures.candidate()
        fixed = RecurringCandidate(fingerprint: fixed.fingerprint, name: fixed.name, category: fixed.category, timing: fixed.timing,
                                   observedFixed: true, median: .needsReview, minimum: fixed.minimum, maximum: fixed.maximum,
                                   coveredFrom: nil, coveredTo: nil, occurrenceCount: 3, evidenceRule: "", evidence: [])
        let d = draft(fixed)
        #expect(d.observedUnsafe && d.expectedText == "")
        #expect(fields(d).contains(.amount))
        var typed = d
        typed.expectedText = "5.00"
        #expect(fields(typed).contains(.amount))
    }

    @Test func nameAndCategoryAreTrimmedAndBounded() {
        var d = draft()
        d.name = "   "; #expect(fields(d) == [.name])
        d.name = String(repeating: "x", count: 500); #expect(fields(d).isEmpty)
        d.name = String(repeating: "x", count: 501); #expect(fields(d) == [.name])
        d = draft()
        d.category = ""; #expect(fields(d) == [.category])
        d.category = String(repeating: "x", count: 100); #expect(fields(d).isEmpty)
        d.category = String(repeating: "x", count: 101); #expect(fields(d) == [.category])
    }

    @Test func timingIsValidated() {
        var d = draft()
        d.dayText = "0"; #expect(fields(d) == [.timing])
        d.dayText = "32"; #expect(fields(d) == [.timing])
        d.dayText = "31"; #expect(fields(d).isEmpty)
        d.beforeText = "-1"; #expect(fields(d) == [.timing])
        d.beforeText = "1.5"; #expect(fields(d) == [.timing])
        d.beforeText = ""; #expect(fields(d) == [.timing])
        d.beforeText = "99999999999"; #expect(fields(d) == [.timing])
        d.beforeText = "0"; d.afterText = "2147483647"; #expect(fields(d).isEmpty)
        d.afterText = "2147483648"; #expect(fields(d) == [.timing])
        var yearly = draft(); yearly.setCadence(.yearly)
        yearly.monthText = "0"; #expect(fields(yearly) == [.timing])
        yearly.monthText = "13"; #expect(fields(yearly) == [.timing])
        yearly.monthText = "2"; yearly.dayText = "30"; #expect(fields(yearly) == [.timing])
        yearly.dayText = "29"; #expect(fields(yearly).isEmpty)
    }

    @Test func amountsAreValidated() {
        var d = draft()
        for bad in ["0", "0.00", "1.234", "abc", "", "-1", "10000000000000000"] { d.expectedText = bad; #expect(fields(d) == [.amount], "\(bad)") }
        d.expectedText = "9999999999999999.99"; #expect(fields(d).isEmpty)
        d.expectedText = ".5"; #expect(fields(d).isEmpty)
        var range = draft(RecurringFixtures.candidate(fixed: false))
        #expect(fields(range).isEmpty)
        range.minimumText = "20.00"; #expect(fields(range) == [.amount])
        range.minimumText = "14.50"; #expect(fields(range).isEmpty)
        range.maximumText = ""; #expect(fields(range) == [.amount])
    }

    @Test func spanishCommaIsAcceptedAndSentWithAPoint() throws {
        var d = draft()
        d.expectedText = "12,5"
        guard case .success(let values) = d.validate(language: .es, deviceLocale: Locale(identifier: "es_ES")) else { Issue.record("invalid"); return }
        #expect(values.body.expectedAmount?.text == "12.50")
    }

    @Test func eachCadenceBuildsTheMatchingShape() throws {
        func body(_ d: ConfirmDraft) throws -> CommitmentRequestBody.Confirm {
            guard case .success(let values) = d.validate(language: .en, deviceLocale: en) else { throw ConfirmError.invalid }
            return values.body
        }
        var d = draft()
        var b = try body(d)
        #expect(b.timingKind == "dayofmonth" && b.day == 15 && b.dayOfWeek == nil && b.month == nil)
        d.monthlyTiming = .monthend
        b = try body(d)
        #expect(b.timingKind == "monthend" && b.day == nil)
        d.setCadence(.weekly); d.weekday = "sunday"
        b = try body(d)
        #expect(b.timingKind == "weekday" && b.dayOfWeek == "sunday" && b.day == nil && b.month == nil)
        d.setCadence(.yearly); d.monthText = "2"; d.dayText = "29"
        b = try body(d)
        #expect(b.timingKind == "monthandday" && b.month == 2 && b.day == 29 && b.dayOfWeek == nil)
    }

    // MARK: Editing a saved recurring expense

    private func editDraft(_ commitment: RecurringCommitment = RecurringFixtures.commitment()) -> ConfirmDraft {
        ConfirmDraft.initial(for: commitment)
    }

    @Test func editPrefillsASavedFixedAmountExactly() {
        let d = editDraft()
        #expect(d.target == .commitment(id: RecurringFixtures.id1))
        #expect(d.name == "Synthetic Rent" && d.category == "bills" && d.cadence == .monthly && d.dayText == "15")
        #expect(d.amountMode == .fixed && d.expectedText == "1200.25" && !d.observedUnsafe && fields(d).isEmpty)
    }

    @Test func editPrefillsASavedRangeOnlyWhereExact() {
        let range = editDraft(RecurringFixtures.commitment(amount: .range(minimum: RecurringFixtures.money("10.00"),
                                                                          maximum: RecurringFixtures.money("14.50"))))
        #expect(range.amountMode == .range && range.minimumText == "10.00" && range.maximumText == "14.50" && fields(range).isEmpty)
        let partial = editDraft(RecurringFixtures.commitment(amount: .range(minimum: RecurringFixtures.money("10.00"), maximum: .needsReview)))
        #expect(partial.minimumText == "10.00" && partial.maximumText == "" && fields(partial) == [.amount])
    }

    @Test func editWithAnUnavailableAmountLeavesItEmptyAndRequiresEntryWithoutBlocking() {
        for amount in [CommitmentAmount.unavailable, .fixed(.needsReview)] {
            var d = editDraft(RecurringFixtures.commitment(amount: amount))
            #expect(d.expectedText == "" && !d.observedUnsafe)
            #expect(fields(d) == [.amount])
            d.expectedText = "5.00"
            #expect(fields(d).isEmpty)
        }
    }

    @Test func editValidatesLikeConfirm() {
        var d = editDraft()
        d.name = ""; #expect(fields(d) == [.name])
        d.name = String(repeating: "x", count: 501); #expect(fields(d) == [.name])
        d = editDraft()
        d.category = String(repeating: "x", count: 101); #expect(fields(d) == [.category])
        d = editDraft()
        d.dayText = "32"; #expect(fields(d) == [.timing])
        var yearly = editDraft(); yearly.setCadence(.yearly)
        yearly.monthText = "2"; yearly.dayText = "30"; #expect(fields(yearly) == [.timing])
        yearly.dayText = "29"; #expect(fields(yearly).isEmpty)
        var range = editDraft(RecurringFixtures.commitment(amount: .range(minimum: RecurringFixtures.money("10.00"),
                                                                          maximum: RecurringFixtures.money("14.50"))))
        range.minimumText = "20.00"; #expect(fields(range) == [.amount])
    }

    @Test func editBodyHasNoFingerprintAndExactMoney() throws {
        var d = editDraft()
        d.expectedText = "0.10"
        guard case .success(let values) = d.validate(language: .en, deviceLocale: en) else { throw ConfirmError.invalid }
        let body = String(decoding: try CommitmentRequestBody.update(values.body), as: UTF8.self)
        #expect(!body.contains("fingerprint") && body.contains(#""expectedAmount":0.10,"#))
        #expect(body.hasPrefix(#"{"amountMode":"fixed","cadence":"monthly","category":"bills""#) && body.hasSuffix(#""windowBeforeDays":1}"#))
    }

    private enum ConfirmError: Error { case invalid }
}
