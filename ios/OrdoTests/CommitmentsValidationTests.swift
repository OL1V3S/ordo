import Foundation
import Testing
@testable import Ordo

@Suite struct CommitmentsValidationTests {
    private let fp = String(repeating: "c", count: 64)
    private let id = "11111111-1111-4111-8111-111111111111"

    private func candidateJSON(fingerprint: String? = nil, extra: String = "", amount: String = #""12.34""#,
                               evidence: String = #"[{"expenseId":7,"date":"2026-09-15","amount":"12.34","description":"Synthetic","category":"bills","source":"manual"}]"#) -> Data {
        Data("""
        {"candidates":[{"fingerprint":"\(fingerprint ?? fp)","algorithmVersion":3,"description":"Synthetic Streaming","category":"bills",
        "cadence":"monthly","timingKind":"dayofmonth","expectedDay":15,"windowBeforeDays":1,"windowAfterDays":2,
        "observedAmountMode":"fixed","observedMedianAmount":\(amount),"observedMinimumAmount":"12.34","observedMaximumAmount":"12.34",
        "coveredFrom":"2026-07-15","coveredTo":"2026-09-15","occurrenceCount":3,"evidenceRule":"consecutive_calendar_months",
        "evidence":\(evidence)\(extra)}],"dismissedCandidates":[]}
        """.utf8)
    }

    private func commitmentJSON(id: String? = nil, lifecycle: String = "active", fields: String = #""amountMode":"fixed","expectedAmount":1200.25"#,
                                evidence: String = "[]") -> Data {
        Data("""
        [{"id":"\(id ?? self.id)","name":"Synthetic Rent","category":"bills","lifecycle":"\(lifecycle)","cadence":"monthly",
        "timingKind":"dayofmonth","expectedDay":15,"windowBeforeDays":1,"windowAfterDays":2,\(fields),
        "createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","evidence":\(evidence)}]
        """.utf8)
    }

    @Test func aFixedCandidateDecodes() throws {
        let (candidates, dismissed) = try CommitmentsValidation.parseCandidates(candidateJSON(extra: #","unknown":1"#))
        let candidate = try #require(candidates.first)
        #expect(dismissed.isEmpty && candidate.fingerprint == fp && candidate.name == "Synthetic Streaming")
        #expect(candidate.observedFixed && candidate.median == .exact(Money.parse("12.34")!))
        #expect(candidate.timing.day == 15 && candidate.timing.windowAfterDays == 2)
        #expect(candidate.coveredFrom == CalendarDate("2026-07-15") && candidate.occurrenceCount == 3)
        #expect(candidate.evidence.count == 1 && candidate.evidence[0].expenseId == 7)
    }

    @Test(arguments: [("1200.25", true), ("9999999999999999.99", true), ("0.10", true), ("1e2", false), ("-1", false),
                      ("0.00", false), ("1.234", false), ("1.5", false), (".50", false), ("01.00", false)])
    func stringAmountsAreExactOrNeedReview(text: String, exact: Bool) {
        let result = CommitmentsValidation.money(fromText: text)
        #expect((result.money != nil) == exact)
        if exact { #expect(result.money?.text == text) }
    }

    @Test func aNumberWhereAStringIsExpectedNeedsReview() throws {
        let (candidates, _) = try CommitmentsValidation.parseCandidates(candidateJSON(amount: "12.34"))
        #expect(candidates[0].median == .needsReview)
    }

    @Test(arguments: ["1200.25", "0.1", "9999999999999999.99", "1234567890123456.78"])
    func numberAmountsAreExact(text: String) throws {
        let rows = try CommitmentsValidation.parseCommitments(commitmentJSON(fields: #""amountMode":"fixed","expectedAmount":\#(text)"#))
        guard case .fixed(let amount) = rows[0].amount, let money = amount.money else { Issue.record("not exact"); return }
        #expect(money.cents == Money.parse(text.contains(".") && text.split(separator: ".")[1].count == 1 ? text + "0" : text)!.cents)
    }

    @Test(arguments: [#""0.5""#, "1.234", "0", "-3", "null", "1e30"])
    func badNumberAmountsDegradeThatFieldOnly(raw: String) throws {
        let rows = try CommitmentsValidation.parseCommitments(commitmentJSON(fields: #""amountMode":"fixed","expectedAmount":\#(raw)"#))
        #expect(rows[0].amount == .fixed(.needsReview) && rows[0].name == "Synthetic Rent")
    }

    @Test func aRangeCommitmentDecodes() throws {
        let rows = try CommitmentsValidation.parseCommitments(commitmentJSON(
            lifecycle: "paused", fields: #""amountMode":"range","expectedMinimumAmount":10,"expectedMaximumAmount":14.5"#))
        #expect(rows[0].lifecycle == .paused)
        #expect(rows[0].amount == .range(minimum: .exact(Money.parse("10.00")!), maximum: .exact(Money.parse("14.50")!)))
    }

    @Test func badDatesDegrade() throws {
        let json = candidateJSON(evidence: #"[{"expenseId":7,"date":"2026-02-30","amount":"1.00","description":"x","category":"bills","source":"manual"}]"#)
        let (candidates, _) = try CommitmentsValidation.parseCandidates(json)
        #expect(candidates[0].evidence[0].date == nil)
    }

    @Test(arguments: [String(repeating: "a", count: 63), String(repeating: "a", count: 65), String(repeating: "g", count: 64),
                      String(repeating: "A", count: 64)])
    func aBadOrUppercaseFingerprintMakesTheWholeResponseMalformed(fingerprint: String) {
        #expect(throws: CommitmentsValidation.ParseError.malformed) {
            try CommitmentsValidation.parseCandidates(candidateJSON(fingerprint: fingerprint))
        }
    }

    @Test func uppercaseHexIsRefusedOnPurposeAndLowercaseAccepted() {
        #expect(!CommitmentsValidation.isFingerprint(String(repeating: "AB", count: 32)))
        #expect(CommitmentsValidation.isFingerprint(String(repeating: "ab", count: 32)))
    }

    @Test func malformedShapesAreRejected() {
        for body in ["[]", "{}", #"{"candidates":{},"dismissedCandidates":[]}"#, #"{"candidates":[]}"#, "null"] {
            #expect(throws: CommitmentsValidation.ParseError.malformed) { try CommitmentsValidation.parseCandidates(Data(body.utf8)) }
        }
        for body in ["{}", "null", #"[{"id":"x"}]"#] {
            #expect(throws: CommitmentsValidation.ParseError.malformed) { try CommitmentsValidation.parseCommitments(Data(body.utf8)) }
        }
        #expect(throws: CommitmentsValidation.ParseError.malformed) { try CommitmentsValidation.parseCandidates(candidateJSON(evidence: "{}")) }
        #expect(throws: CommitmentsValidation.ParseError.malformed) {
            try CommitmentsValidation.parseCandidates(candidateJSON(evidence: #"[{"date":"2026-09-15"}]"#))
        }
    }

    @Test func aBadGuidOrUnknownLifecycleOrMissingNameIsMalformed() {
        #expect(throws: CommitmentsValidation.ParseError.malformed) { try CommitmentsValidation.parseCommitments(commitmentJSON(id: "not-a-guid")) }
        #expect(throws: CommitmentsValidation.ParseError.malformed) { try CommitmentsValidation.parseCommitments(commitmentJSON(lifecycle: "deleted")) }
        #expect(throws: CommitmentsValidation.ParseError.malformed) {
            try CommitmentsValidation.parseCommitments(Data(#"[{"id":"\#(id)","lifecycle":"active","evidence":[]}]"#.utf8))
        }
        #expect(throws: CommitmentsValidation.ParseError.malformed) {
            try CommitmentsValidation.parseCommitments(commitmentJSON(evidence: #"[{"expenseId":0}]"#))
        }
    }
}
