import Foundation
import Testing
@testable import Ordo

@Suite struct PaychecksValidationTests {
    private func parse(_ json: String) throws -> PaychecksSnapshot { try PaychecksValidation.parse(Data(json.utf8)) }

    private func profileJSON(_ amountJSON: String, extra: String = "") -> String {
        """
        {"evaluatedOn":"2026-10-20","paychecks":[{"id":"\(PaycheckFixtures.id1)","displayName":"X","lifecycle":"active",
        "amount":\(amountJSON),"evidence":[],"receiptSlots":[]\(extra)}]}
        """
    }

    @Test func theFullFixtureDecodes() throws {
        let snapshot = try PaychecksValidation.parse(try Fixtures.data("paychecks-full"))
        #expect(snapshot.evaluatedOn == PaycheckFixtures.date("2026-10-20"))
        #expect(snapshot.profiles.count == 2)
        let active = snapshot.profiles[0]
        #expect(active.lifecycle == .active && active.isManual)
        #expect(active.amount == .fixed(.exact(Money.parse("1200.25")!)))
        #expect(active.schedule?.cadence == .biweekly && active.schedule?.reference == PaycheckFixtures.date("2026-10-16"))
        #expect(active.slots.map(\.relation) == [.current, .previous])
        #expect(active.projection?.latest == PaycheckFixtures.date("2026-11-01"))
        #expect(active.evidence.first?.kind == .recordedReceipt && active.evidence.first?.timingOffsetDays == 0)
        let paused = snapshot.profiles[1]
        #expect(paused.schedule?.cadence == .semimonthly)
        #expect(paused.schedule?.first == .day(1) && paused.schedule?.second == .monthEnd)
        #expect(paused.amount == .range(minimum: .exact(Money.parse("100.00")!), maximum: .exact(Money.parse("250.50")!)))
        #expect(paused.slots.isEmpty && paused.projection == nil)
        #expect(paused.evidence.first?.kind == .confirmationEvidence && paused.evidence.first?.edited == true)
        #expect(snapshot.claimedInflowIds == [5, 6])
    }

    @Test func originAndTimestampsAreNeverCarried() throws {
        let snapshot = try PaychecksValidation.parse(try Fixtures.data("paychecks-full"))
        let printed = "\(snapshot.profiles[0]) \(snapshot.profiles[0].evidence[0])"
        #expect(!printed.contains("secret-fingerprint") && !printed.contains("Synthetic"))
    }

    @Test(arguments: [("1200.25", "1200.25"), ("0.1", "0.10"), ("9999999999999999.99", "9999999999999999.99"),
                      ("1234567890123456.78", "1234567890123456.78"), ("4503599627370497.01", "4503599627370497.01"),
                      ("70368744177664.01", "70368744177664.01"), ("100", "100.00"), ("1e2", "100.00")])
    func moneyIsDecodedExactlyIncludingAbove2To53Cents(json: String, text: String) throws {
        let snapshot = try parse(profileJSON(#"{"mode":"fixed","fixedAmount":\#(json)}"#))
        #expect(snapshot.profiles[0].amount == .fixed(.exact(Money.parse(text)!)))
    }

    @Test(arguments: ["\"12.50\"", "null", "0", "-5.00", "1.234", "10000000000000000.00", "0.001", "true"])
    func inexactOrOutOfRangeAmountsNeedReview(json: String) throws {
        let snapshot = try parse(profileJSON(#"{"mode":"fixed","fixedAmount":\#(json)}"#))
        #expect(snapshot.profiles[0].amount == .fixed(.needsReview))
    }

    @Test func aBadAmountDoesNotFailTheResponse() throws {
        let snapshot = try parse(profileJSON(#"{"mode":"range","minimumAmount":"x","maximumAmount":10.00}"#))
        #expect(snapshot.profiles[0].amount == .range(minimum: .needsReview, maximum: .exact(Money.parse("10.00")!)))
        #expect(try parse(profileJSON(#"{"mode":"weird"}"#)).profiles[0].amount == .unavailable)
    }

    @Test func badDatesDegradeAndASlotWithABadDateIsDropped() throws {
        let json = """
        {"evaluatedOn":"nope","paychecks":[{"id":"\(PaycheckFixtures.id1)","displayName":"X","lifecycle":"active",
        "schedule":{"cadence":"weekly","referenceAnchorDate":"2026-13-40"},
        "evidence":[{"accountInflowId":3,"postedDate":"bad","amount":1.00,"description":"d","slotAnchor":"bad","assignmentKind":"recorded_receipt"}],
        "receiptSlots":[{"relation":"current","anchor":"2026-10-16","earliestExpectedDate":"2026-10-15","latestExpectedDate":"oops"},
                        {"relation":"previous","anchor":"2026-10-02","earliestExpectedDate":"2026-10-01","latestExpectedDate":"2026-10-04"}]}]}
        """
        let snapshot = try parse(json)
        #expect(snapshot.evaluatedOn == nil)
        #expect(snapshot.profiles[0].schedule?.reference == nil)
        #expect(snapshot.profiles[0].evidence[0].postedDate == nil)
        #expect(snapshot.profiles[0].slots.map(\.relation) == [.previous])
    }

    @Test func unknownCadenceAndSourceDegrade() throws {
        let json = """
        {"paychecks":[{"id":"\(PaycheckFixtures.id1)","displayName":"X","lifecycle":"ended","schedule":{"cadence":"yearly"},
        "evidence":[{"accountInflowId":3,"description":"d","source":"fax","assignmentKind":"recorded_receipt"}],"receiptSlots":[]}]}
        """
        let profile = try parse(json).profiles[0]
        #expect(profile.schedule?.cadence == .unknown)
        #expect(profile.evidence[0].source == .unknown)
    }

    @Test(arguments: [
        "[]", "\"x\"", #"{"paychecks":{}}"#, #"{"evaluatedOn":"2026-10-20"}"#,
        #"{"paychecks":[{"id":"not-a-guid","displayName":"X","lifecycle":"active","evidence":[],"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":7,"lifecycle":"active","evidence":[],"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"archived","evidence":[],"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"active","evidence":{},"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"active","evidence":[],"receiptSlots":null}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"active","evidence":[{"description":"d","assignmentKind":"recorded_receipt"}],"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"active","evidence":[{"accountInflowId":0,"assignmentKind":"recorded_receipt"}],"receiptSlots":[]}]}"#,
        #"{"paychecks":[{"id":"11111111-1111-4111-8111-111111111111","displayName":"X","lifecycle":"active","evidence":[{"accountInflowId":3,"assignmentKind":"mystery"}],"receiptSlots":[]}]}"#,
    ])
    func malformedResponsesAreRejectedWhole(json: String) {
        #expect(throws: PaychecksValidation.ParseError.self) { try PaychecksValidation.parse(Data(json.utf8)) }
    }

    @Test func inflowsDecodeWithPerRowDegrade() throws {
        let rows = try PaychecksValidation.parseDeposits(try Fixtures.data("inflows-list"))
        #expect(rows.map(\.id) == [9, 6, 5, 4])
        #expect(rows[3].amount == .exact(Money.parse("0.10")!))
        let degraded = try PaychecksValidation.parseDeposits(Data(#"[{"id":1,"description":"d","amount":"x","date":"bad"}]"#.utf8))
        #expect(degraded[0].amount == .needsReview && degraded[0].date == nil)
    }

    @Test(arguments: ["{}", #"[{"id":0,"description":"d"}]"#, #"[{"id":1}]"#, #"[{"id":"1","description":"d"}]"#])
    func inflowFailureModesHideTheWholeList(json: String) {
        #expect(throws: PaychecksValidation.ParseError.self) { try PaychecksValidation.parseDeposits(Data(json.utf8)) }
    }
}
