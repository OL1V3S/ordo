import Foundation
import Testing
@testable import Ordo

@Suite struct HomeDecodingTests {
    @Test func allAvailable() throws {
        let home = try Fixtures.snapshot("home-all-available")
        #expect(home.currencyCode == "USD")
        #expect(home.activityThroughDate == CalendarDate("2026-10-17"))
        guard case .available(let items) = home.recentActivity else { Issue.record("recent"); return }
        #expect(items.count == 3)
        #expect(items[0].amount.text == "9999999999999999.99")
        #expect(items[0].amount.cents == 999_999_999_999_999_999)
        #expect(items[1].paycheckLinked)
        guard case .available(let attention) = home.attention else { Issue.record("attention"); return }
        #expect(attention.commitmentItems.count == 1)
        #expect(attention.budgetItems.count == 2)
        #expect(!attention.isPartial)
        guard case .available(let upcoming) = home.upcoming else { Issue.record("upcoming"); return }
        #expect(upcoming.items.count == 2)
        #expect(upcoming.through == CalendarDate("2026-10-30"))
    }

    @Test func availableEmptyIsEmptyNotUnavailable() throws {
        let home = try Fixtures.snapshot("home-available-empty")
        #expect(home.recentActivity == .available([]))
        guard case .available(let attention) = home.attention else { Issue.record("attention"); return }
        #expect(attention.commitmentItems.isEmpty && attention.budgetItems.isEmpty && !attention.isPartial)
        guard case .available(let upcoming) = home.upcoming else { Issue.record("upcoming"); return }
        #expect(upcoming.items.isEmpty)
    }

    @Test func mixedAttentionOutcomes() throws {
        guard case .available(let commitmentOnly) = try Fixtures.snapshot("home-attention-commitment-only").attention else {
            Issue.record("commitment only"); return
        }
        #expect(commitmentOnly.isPartial && commitmentOnly.commitmentItems.count == 1 && commitmentOnly.budgetItems.isEmpty)
        guard case .available(let budgetOnly) = try Fixtures.snapshot("home-attention-budget-only").attention else {
            Issue.record("budget only"); return
        }
        #expect(budgetOnly.isPartial && budgetOnly.budgetItems.count == 1 && budgetOnly.commitmentItems.isEmpty)
        #expect(try Fixtures.snapshot("home-attention-both-unavailable").attention == .unavailable)
    }

    @Test func unavailableNeverDecodesAsEmpty() throws {
        #expect(try Fixtures.snapshot("home-recent-unavailable").recentActivity == .unavailable)
        #expect(try Fixtures.snapshot("home-upcoming-unavailable").upcoming == .unavailable)
    }

    @Test func upcomingRange() throws {
        guard case .available(let upcoming) = try Fixtures.snapshot("home-upcoming-range").upcoming else {
            Issue.record("upcoming"); return
        }
        #expect(upcoming.items.first?.amount == .range(minimum: Money.parse("200.00")!, maximum: Money.parse("450.00")!))
    }

    @Test func unknownCodeMakesOnlyThatSectionMalformed() throws {
        let home = try Fixtures.snapshot("home-unknown-code")
        #expect(home.attention == .malformed)
        #expect(home.recentActivity == .available([]))
    }

    @Test(arguments: ["home-invalid-amount", "home-zero-amount", "home-inflow-with-category", "home-non-usd"])
    func invalidEnvelopeFailsTheWholeRead(fixture: String) throws {
        #expect(throws: HomeValidation.ParseError.invalidEnvelope) { try Fixtures.snapshot(fixture) }
    }

    @Test func misalignedHorizonMakesUpcomingMalformed() throws {
        #expect(try Fixtures.snapshot("home-misaligned-horizon").upcoming == .malformed)
    }

    @Test func garbageIsInvalid() {
        #expect(throws: HomeValidation.ParseError.invalidEnvelope) { try HomeValidation.parse(Data("[]".utf8)) }
        #expect(throws: HomeValidation.ParseError.invalidEnvelope) { try HomeValidation.parse(Data("nope".utf8)) }
    }

    @Test func homeUnavailableBodyIsNotAHomeResponse() throws {
        #expect(throws: HomeValidation.ParseError.invalidEnvelope) { try Fixtures.snapshot("home-unavailable-503") }
        #expect(OrdoAPI.errorCode(in: try Fixtures.data("home-unavailable-503")) == "home_unavailable")
    }

    @Test func moneyParsing() {
        #expect(Money.parse("0.00") == nil)
        #expect(Money.parse("0.00", allowZero: true)?.cents == 0)
        #expect(Money.parse("1.5") == nil)
        #expect(Money.parse("01.50") == nil)
        #expect(Money.parse("-1.50") == nil)
        #expect(Money.parse("10000000000000000.00") == nil)
        #expect(Money.parse("9999999999999999.99")?.cents == Money.maximumCents)
    }

    @Test func calendarDateIsStrict() {
        #expect(CalendarDate("2026-02-29") == nil)
        #expect(CalendarDate("2024-02-29") != nil)
        #expect(CalendarDate("2026-1-05") == nil)
        #expect(CalendarDate("２０２６-10-17") == nil)
        #expect(CalendarDate("2026-10-17")?.adding(days: 13)?.isoString == "2026-10-30")
        #expect(CalendarDate("2026-12-25")?.adding(days: 13)?.isoString == "2027-01-07")
        #expect(CalendarDate("9999-12-31")?.adding(days: 1) == nil)
    }
}
