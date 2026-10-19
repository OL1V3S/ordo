import Foundation
import Testing
@testable import Ordo

@Suite struct BudgetMonthTests {
    @Test func theKeyIsZeroPaddedAndTheWireValueIsTheFirstOfTheMonth() {
        #expect(BudgetMonth(year: 2026, month: 10)!.key == "2026-10")
        #expect(BudgetMonth(year: 2026, month: 3)!.key == "2026-03")
        #expect(BudgetMonth(year: 1, month: 1)!.key == "0001-01")
        #expect(BudgetMonth(year: 999, month: 12)!.key == "0999-12")
        #expect(BudgetMonth(year: 2026, month: 10)!.monthYearWireValue == "2026-10-01")
        #expect(BudgetMonth(year: 9999, month: 12)!.monthYearWireValue == "9999-12-01")
    }

    @Test(arguments: ["2026-10", "0001-01", "9999-12", "2026-01"])
    func aStrictKeyParses(key: String) throws {
        let month = try #require(BudgetMonth(key: key))
        #expect(month.key == key)
    }

    @Test(arguments: ["", "2026-1", "2026-13", "2026-00", "0000-01", "2026-10-01", " 2026-10", "2026-10 ",
                      "2026/10", "+026-10", "abcd-ef", "２０２６-10", "2026-１0", "026-10", "20261-0", "2026–10"])
    func anythingElseIsRejected(key: String) {
        #expect(BudgetMonth(key: key) == nil)
    }

    @Test func steppingCrossesTheYearBoundary() {
        #expect(BudgetMonth(year: 2026, month: 12)!.next == BudgetMonth(year: 2027, month: 1))
        #expect(BudgetMonth(year: 2027, month: 1)!.previous == BudgetMonth(year: 2026, month: 12))
        #expect(BudgetMonth(year: 2026, month: 10)!.shifted(by: 25) == BudgetMonth(year: 2028, month: 11))
        #expect(BudgetMonth(year: 2026, month: 10)!.shifted(by: -10) == BudgetMonth(year: 2025, month: 12))
        #expect(BudgetMonth(year: 2026, month: 10)!.shifted(by: 0) == BudgetMonth(year: 2026, month: 10))
    }

    @Test func steppingStopsAtTheFirstAndLastMonthTheServerCanStore() {
        #expect(BudgetMonth.earliest.previous == nil)
        #expect(BudgetMonth.latest.next == nil)
        #expect(BudgetMonth.earliest.next == BudgetMonth(year: 1, month: 2))
        #expect(BudgetMonth.latest.previous == BudgetMonth(year: 9999, month: 11))
        #expect(BudgetMonth(year: 1, month: 6)!.shifted(by: -6) == nil)
    }

    @Test func monthsCompareInCalendarOrder() {
        #expect(BudgetMonth(year: 2026, month: 9)! < BudgetMonth(year: 2026, month: 10)!)
        #expect(BudgetMonth(year: 2025, month: 12)! < BudgetMonth(year: 2026, month: 1)!)
        #expect(!(BudgetMonth(year: 2026, month: 10)! < BudgetMonth(year: 2026, month: 10)!))
    }

    @Test func firstAndLastDayFollowTheCalendar() {
        #expect(BudgetMonth(year: 2028, month: 2)!.lastDay.isoString == "2028-02-29")
        #expect(BudgetMonth(year: 2027, month: 2)!.lastDay.isoString == "2027-02-28")
        #expect(BudgetMonth(year: 2026, month: 10)!.firstDay.isoString == "2026-10-01")
        #expect(BudgetMonth(year: 2026, month: 10)!.lastDay.isoString == "2026-10-31")
    }

    @Test func theNextResetDayIsTheFirstOfTheNextMonth() {
        #expect(BudgetMonth(year: 2026, month: 10)!.nextResetDay?.isoString == "2026-11-01")
        #expect(BudgetMonth(year: 2026, month: 12)!.nextResetDay?.isoString == "2027-01-01")
        #expect(BudgetMonth.latest.nextResetDay == nil)
    }

    @Test(arguments: [
        // (instant, UTC offset hours, expected month)
        ("2026-10-31T23:30:00Z", 0, "2026-10"),
        ("2026-10-31T23:30:00Z", 14, "2026-11"),
        ("2026-10-31T23:30:00Z", 2, "2026-11"),
        ("2026-10-31T23:30:00Z", -6, "2026-10"),
        ("2026-10-31T23:30:00Z", -12, "2026-10"),
        ("2026-11-01T00:30:00Z", 0, "2026-11"),
        ("2026-11-01T00:30:00Z", -6, "2026-10"),
        ("2026-11-01T00:30:00Z", -12, "2026-10"),
        ("2026-11-01T00:30:00Z", 2, "2026-11"),
        ("2026-11-01T00:30:00Z", 14, "2026-11"),
        ("2026-12-31T23:59:00Z", 14, "2027-01"),
        ("2027-01-01T00:01:00Z", -12, "2026-12"),
    ])
    func theCurrentMonthIsTheDeviceCalendarMonth(instant: String, offsetHours: Int, expected: String) throws {
        let date = try #require(ISO8601DateFormatter().date(from: instant))
        let zone = try #require(TimeZone(secondsFromGMT: offsetHours * 3600))
        #expect(BudgetMonth.current(now: date, timeZone: zone).key == expected)
        #expect(BudgetMonth.current(now: date, timeZone: zone) == BudgetMonth(containing: DateFormatting.localCalendarDate(now: date, timeZone: zone)))
    }

    @Test func theLabelIsLocaleAwareAndIndependentOfTheDeviceTimeZone() {
        let october = BudgetMonth(year: 2026, month: 10)!
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }
        var labels = Set<String>()
        for id in ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"] {
            NSTimeZone.default = TimeZone(identifier: id)!
            labels.insert(october.label(language: .en))
        }
        #expect(labels == ["October 2026"])
        #expect(october.label(language: .es) == "octubre de 2026")
        #expect(BudgetMonth(year: 2027, month: 1)!.label(language: .es) == "enero de 2027")
    }
}
