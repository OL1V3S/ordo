import Foundation
import Testing
@testable import Ordo

private func day(_ text: String) -> CalendarDate { CalendarDate(text)! }

@Suite struct TimelineFilterTests {
    // MARK: Rules

    @Test func theSearchIsTrimmedWhenNormalised() {
        var filter = TimelineFilter()
        filter.q = " \n lunch \t"
        #expect(TimelineFilterRules.normalize(filter).q == "lunch")
    }

    @Test func theSearchLimitIsOneHundredUTF16UnitsAfterTrimming() {
        var filter = TimelineFilter()
        filter.q = String(repeating: "a", count: 100)
        #expect(TimelineFilterRules.validate(filter) == nil)
        filter.q = "  " + String(repeating: "a", count: 100) + "  "
        #expect(TimelineFilterRules.validate(filter) == nil) // trimmed first
        filter.q = String(repeating: "a", count: 101)
        #expect(TimelineFilterRules.validate(filter) == .search)
    }

    @Test func theSearchLimitCountsUTF16UnitsSoEmojiCountTwice() {
        var filter = TimelineFilter()
        filter.q = String(repeating: "😀", count: 50) // 100 units
        #expect(TimelineFilterRules.validate(filter) == nil)
        filter.q = String(repeating: "😀", count: 51) // 102 units, 51 characters
        #expect(filter.q.count == 51)
        #expect(TimelineFilterRules.validate(filter) == .search)
    }

    @Test func aRangeWithFromAfterToIsNotApplied() {
        var filter = TimelineFilter()
        filter.from = day("2026-10-18")
        filter.to = day("2026-10-17")
        #expect(TimelineFilterRules.validate(filter) == .range)
        filter.to = day("2026-10-18") // inclusive: the same day is fine
        #expect(TimelineFilterRules.validate(filter) == nil)
        filter.from = nil
        #expect(TimelineFilterRules.validate(filter) == nil)
    }

    @Test func activeMeansAnyFilterIsSet() {
        #expect(!TimelineFilterRules.isActive(TimelineFilter()))
        var filter = TimelineFilter()
        filter.q = "   "
        #expect(!TimelineFilterRules.isActive(filter))
        filter.q = "x"
        #expect(TimelineFilterRules.isActive(filter))
        #expect(TimelineFilterRules.isActive(TimelineFilter(kind: .expense)))
        #expect(TimelineFilterRules.isActive(TimelineFilter(from: day("2026-01-01"))))
    }

    @Test func onlyASearchChangeIsDebounced() {
        let base = TimelineFilter()
        var search = base
        search.q = "x"
        #expect(TimelineFilterRules.isSearchOnlyChange(from: base, to: search))
        #expect(!TimelineFilterRules.isSearchOnlyChange(from: base, to: TimelineFilter(kind: .expense)))
        #expect(!TimelineFilterRules.isSearchOnlyChange(from: base, to: TimelineFilter(from: day("2026-01-01"))))
        #expect(!TimelineFilterRules.isSearchOnlyChange(from: base, to: TimelineFilter(to: day("2026-01-01"))))
    }

    // MARK: Period presets

    private func range(_ period: TimelinePeriod, _ today: String) -> (String?, String?)? {
        TimelineFilterRules.range(for: period, today: day(today)).map { ($0.from?.isoString, $0.to?.isoString) }
    }

    @Test func allClearsBothBoundsAndCustomKeepsTheUsersDates() {
        let all = range(.all, "2026-10-17")
        #expect(all?.0 == nil && all?.1 == nil)
        #expect(range(.custom, "2026-10-17") == nil)
    }

    @Test func lastSevenDaysIsSixDaysAgoThroughToday() {
        #expect(range(.last7, "2026-10-17")! == ("2026-10-11", "2026-10-17"))
        #expect(range(.last7, "2026-10-04")! == ("2026-09-28", "2026-10-04")) // across a month end
        #expect(range(.last7, "2026-01-03")! == ("2025-12-28", "2026-01-03")) // across a year end
    }

    @Test func lastThirtyDaysIsTwentyNineDaysAgoThroughToday() {
        #expect(range(.last30, "2026-10-17")! == ("2026-09-18", "2026-10-17"))
        #expect(range(.last30, "2028-03-01")! == ("2028-02-01", "2028-03-01")) // through a leap February
        #expect(range(.last30, "2026-03-01")! == ("2026-01-31", "2026-03-01")) // through a normal February
    }

    @Test func thisMonthIsTheFirstThroughTheLastDay() {
        #expect(range(.thisMonth, "2026-10-17")! == ("2026-10-01", "2026-10-31"))
        #expect(range(.thisMonth, "2026-04-30")! == ("2026-04-01", "2026-04-30"))
        #expect(range(.thisMonth, "2026-12-31")! == ("2026-12-01", "2026-12-31"))
        #expect(range(.thisMonth, "2026-02-10")! == ("2026-02-01", "2026-02-28"))
        #expect(range(.thisMonth, "2028-02-10")! == ("2028-02-01", "2028-02-29")) // leap year
        #expect(range(.thisMonth, "2100-02-10")! == ("2100-02-01", "2100-02-28")) // not a leap year
        #expect(range(.thisMonth, "2000-02-10")! == ("2000-02-01", "2000-02-29")) // a leap year
    }

    // MARK: Device-local days, never UTC

    @MainActor private func model(now: Date, zone: TimeZone, delay: Duration = .milliseconds(20)) -> TransactionsViewModel {
        TransactionsViewModel(service: ScriptedTransactionsService(), searchDelay: delay,
                              now: { now }, timeZone: { zone })
    }

    @MainActor @Test func presetsUseTheDeviceTimeZoneNotUTC() {
        // 2026-10-18 02:30 UTC is still 2026-10-17 in Los Angeles and already 2026-10-18 in Auckland.
        let instant = Date(timeIntervalSince1970: 1_792_290_600)
        let losAngeles = model(now: instant, zone: TimeZone(identifier: "America/Los_Angeles")!)
        losAngeles.setPeriod(.last7)
        #expect(losAngeles.draft.to?.isoString == "2026-10-17" && losAngeles.draft.from?.isoString == "2026-10-11")
        let auckland = model(now: instant, zone: TimeZone(identifier: "Pacific/Auckland")!)
        auckland.setPeriod(.last7)
        #expect(auckland.draft.to?.isoString == "2026-10-18" && auckland.draft.from?.isoString == "2026-10-12")
    }

    @MainActor @Test func choosingCustomKeepsTheDatesAndEditingADateSwitchesToCustom() {
        let vm = model(now: TimelineFixtures.fixedNow, zone: TimelineFixtures.utc)
        vm.setPeriod(.last30)
        #expect(vm.draft.from?.isoString == "2026-09-18")
        vm.setPeriod(.custom)
        #expect(vm.period == .custom && vm.draft.from?.isoString == "2026-09-18" && vm.draft.to?.isoString == "2026-10-17")
        vm.setPeriod(.thisMonth)
        vm.setFrom(day("2026-10-05"))
        #expect(vm.period == .custom && vm.draft.from?.isoString == "2026-10-05" && vm.draft.to?.isoString == "2026-10-31")
        vm.setPeriod(.all)
        #expect(vm.draft.from == nil && vm.draft.to == nil)
    }

    // MARK: Applying (debounce)

    @MainActor @Test func searchIsDebouncedButKindAndDatesApplyAtOnce() async {
        let vm = model(now: TimelineFixtures.fixedNow, zone: TimelineFixtures.utc, delay: .milliseconds(60))
        await vm.loadIfNeeded()
        vm.setSearchText("lun")
        vm.setSearchText("lunch ")
        #expect(vm.applied.q == "") // not yet
        #expect(await waitUntil { await MainActor.run { vm.applied.q == "lunch" } })
        vm.setKind(.expense)
        #expect(vm.applied.kind == .expense) // at once
        vm.setFrom(day("2026-10-01"))
        #expect(vm.applied.from?.isoString == "2026-10-01")
    }

    @MainActor @Test func aFurtherKeystrokeRestartsTheDebounce() async {
        let vm = model(now: TimelineFixtures.fixedNow, zone: TimelineFixtures.utc, delay: .milliseconds(120))
        await vm.loadIfNeeded()
        vm.setSearchText("a")
        try? await Task.sleep(for: .milliseconds(70))
        vm.setSearchText("ab")
        try? await Task.sleep(for: .milliseconds(70))
        #expect(vm.applied.q == "") // the first timer was cancelled
        #expect(await waitUntil { await MainActor.run { vm.applied.q == "ab" } })
    }

    @MainActor @Test func anInvalidDraftIsNeverApplied() async {
        let vm = model(now: TimelineFixtures.fixedNow, zone: TimelineFixtures.utc)
        await vm.loadIfNeeded()
        vm.setSearchText(String(repeating: "a", count: 101))
        #expect(vm.filterProblem == .search)
        try? await Task.sleep(for: .milliseconds(80))
        #expect(vm.applied.q == "")
        vm.setSearchText("ok")
        vm.setFrom(day("2026-10-18"))
        vm.setTo(day("2026-10-17"))
        #expect(vm.filterProblem == .range)
        // A lone `from` was valid and applied; adding an earlier `to` made the draft invalid, so it was not.
        #expect(vm.applied.to == nil)
    }
}
