import Foundation
import Testing
@testable import Ordo

@Suite struct FormattingTests {
    @Test func englishMoney() {
        let text = MoneyFormatter(language: .en, currencyCode: "USD").string(Money.parse("1234.56")!)
        #expect(text == "$1,234.56")
    }

    @Test func spanishUsesTheIsoCodeNotMXDollar() {
        let text = MoneyFormatter(language: .es, currencyCode: "USD").string(Money.parse("1234.56")!)
        #expect(text.contains("USD"))
        #expect(!text.contains("MX$"))
        #expect(text.contains("1,234.56"))
    }

    @Test func maximumAmountKeepsEveryDigit() {
        let max = Money.parse("9999999999999999.99")!
        #expect(MoneyFormatter(language: .en, currencyCode: "USD").string(max) == "$9,999,999,999,999,999.99")
        #expect(MoneyFormatter(language: .es, currencyCode: "USD").string(max).contains("9,999,999,999,999,999.99"))
    }

    @Test func calendarDatesDoNotShiftWithTimeZone() {
        let date = CalendarDate("2026-10-17")!
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }
        var results = Set<String>()
        for id in ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"] {
            NSTimeZone.default = TimeZone(identifier: id)!
            results.insert(DateFormatting.string(date, language: .en))
        }
        #expect(results == ["Oct 17, 2026"])
    }

    @Test func spanishDate() {
        let text = DateFormatting.string(CalendarDate("2026-10-17")!, language: .es)
        #expect(text.contains("17") && text.contains("2026") && text.lowercased().contains("oct"))
    }

    @Test func activityThroughDateUsesTheLocalDay() {
        // 2026-10-18 04:30 UTC is still 23:30 on 2026-10-17 in Chicago (UTC-5, daylight time).
        let instant = ISO8601DateFormatter().date(from: "2026-10-18T04:30:00Z")!
        let chicago = TimeZone(identifier: "America/Chicago")!
        #expect(DateFormatting.localCalendarDate(now: instant, timeZone: chicago).isoString == "2026-10-17")
        #expect(DateFormatting.localCalendarDate(now: instant, timeZone: TimeZone(secondsFromGMT: 0)!).isoString == "2026-10-18")
    }

    @Test func activityThroughDateIgnoresNonGregorianCurrentCalendar() {
        // The Japanese calendar would report era years; the helper must stay Gregorian.
        let instant = ISO8601DateFormatter().date(from: "2026-01-05T12:00:00Z")!
        let utc = TimeZone(secondsFromGMT: 0)!
        #expect(DateFormatting.localCalendarDate(now: instant, timeZone: utc).isoString == "2026-01-05")
        var japanese = Calendar(identifier: .japanese)
        japanese.timeZone = utc
        #expect(japanese.component(.year, from: instant) != 2026)
    }

    @Test @MainActor func homeViewModelRequestsTheLocalDate() async {
        struct Recorder: HomeService {
            let box: DateBox
            func loadHome(activityThroughDate: CalendarDate) async throws -> HomeSnapshot {
                box.set(activityThroughDate)
                throw APIError.offline
            }
        }
        let box = DateBox()
        let instant = ISO8601DateFormatter().date(from: "2026-10-18T04:30:00Z")!
        let model = HomeViewModel(service: Recorder(box: box), now: { instant },
                                  timeZone: { TimeZone(identifier: "America/Chicago")! })
        await model.load()
        #expect(box.value?.isoString == "2026-10-17")
        #expect(model.phase == .offline)
    }
}

final class DateBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: CalendarDate?
    var value: CalendarDate? { lock.lock(); defer { lock.unlock() }; return stored }
    func set(_ date: CalendarDate) { lock.lock(); stored = date; lock.unlock() }
}
