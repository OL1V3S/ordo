import Foundation
import Testing
@testable import Ordo

enum ChangeFixtures {
    static let fp = RecurringFixtures.fp1
    static let fp2 = RecurringFixtures.fp2
    static let id = RecurringFixtures.id1

    static let observation = #"{"expenseId":7,"date":"2026-09-15","amount":"12.34","description":"Synthetic","category":"bills","source":"manual","slotAnchor":"2026-09-15","timingOffsetDays":0,"isWithinTimingWindow":true}"#

    static func amountJSON(_ fingerprint: String = fp, decision: String = "pending", state: String = "proposed_change",
                           mode: String = "fixed", amount: String = "12.34", ids: String = "[7]") -> String {
        """
        {"state":"\(state)","fingerprint":"\(fingerprint)","decisionState":"\(decision)","proposedMode":"\(mode)",
        "proposedAmount":"\(amount)","proposedMinimumAmount":"10.00","proposedMaximumAmount":"14.50","observedMedianAmount":"12.34",
        "evidenceExpenseIds":\(ids)}
        """
    }

    static let none = #"{"state":"none","fingerprint":null,"decisionState":null,"evidenceExpenseIds":[],"missedSlotAnchors":[]}"#

    static func timingJSON(_ fingerprint: String = fp2, decision: String = "pending") -> String {
        """
        {"state":"proposed_change","fingerprint":"\(fingerprint)","decisionState":"\(decision)","proposedTimingKind":"dayofmonth",
        "proposedDay":20,"proposedWindowBeforeDays":1,"proposedWindowAfterDays":3,"evidenceExpenseIds":[7]}
        """
    }

    static func missingJSON(_ state: String = "possibly_ended", fingerprint: String = fp, decision: String = "pending") -> String {
        """
        {"state":"\(state)","fingerprint":"\(fingerprint)","decisionState":"\(decision)","missedSlotAnchors":["2026-08-15","2026-09-15"]}
        """
    }

    static func body(amount: String = none, timing: String = none, missing: String = none, observations: String = observation,
                     expected: String = "1200.25", commitmentId: String = id) -> String {
        """
        {"evaluatedOn":"2026-10-01","changes":[{"commitment":{"id":"\(commitmentId)","name":"Synthetic Rent","category":"bills",
        "lifecycle":"active","cadence":"monthly","timingKind":"dayofmonth","expectedDay":15,"windowBeforeDays":1,"windowAfterDays":2,
        "amountMode":"fixed","expectedAmount":\(expected)},"algorithmVersion":"detector-3","isMatchingAvailable":true,
        "observations":[\(observations)],"amount":\(amount),"timing":\(timing),"missing":\(missing)}]}
        """
    }

    static func parse(_ text: String) throws -> CommitmentChangesSnapshot {
        try CommitmentChangesValidation.parse(Data(text.utf8))
    }

    static func snapshot(amount: String = none, timing: String = none, missing: String = none) throws -> CommitmentChangesSnapshot {
        try parse(body(amount: amount, timing: timing, missing: missing))
    }
}

@Suite struct CommitmentChangesParsingTests {
    @Test func fixedProposalAndSnapshotMoneyAreExactDecimals() throws {
        let snapshot = try ChangeFixtures.parse(ChangeFixtures.body(amount: ChangeFixtures.amountJSON(amount: "1234.56", ids: "[7]"),
                                                                    observations: ChangeFixtures.observation, expected: "0.1"))
        let change = try #require(snapshot.changes.first)
        #expect(change.commitment.amount == .fixed(RecurringFixtures.money("0.10")))
        guard case .amount(let proposed) = change.assessments[0].proposal else { Issue.record("not an amount"); return }
        #expect(proposed == .fixed(RecurringFixtures.money("1234.56")))
        #expect(snapshot.evaluatedOn == CalendarDate("2026-10-01") && change.algorithmVersion == "detector-3")
        let rent = try ChangeFixtures.parse(ChangeFixtures.body(expected: "1200.25"))
        #expect(rent.changes[0].commitment.amount == .fixed(RecurringFixtures.money("1200.25")))
    }

    @Test func aRangeProposalIsParsed() throws {
        let snapshot = try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(mode: "range"))
        guard case .amount(let proposed) = snapshot.changes[0].assessments[0].proposal else { Issue.record("not an amount"); return }
        #expect(proposed == .range(minimum: RecurringFixtures.money("10.00"), maximum: RecurringFixtures.money("14.50")))
        #expect(snapshot.changes[0].assessments[0].isExact)
    }

    @Test(arguments: ["12.345", "1e2", "12.3", "0.00", "-1.00", ""])
    func aNonExactProposedAmountDisablesEveryAction(text: String) throws {
        let assessment = try #require(ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(amount: text)).changes[0].assessments.first)
        #expect(!assessment.isExact && !assessment.isActionable)
    }

    @Test func aRangeWithOneNonExactBoundIsNotExact() throws {
        let json = ChangeFixtures.amountJSON(mode: "range").replacingOccurrences(of: "\"10.00\"", with: "\"10.001\"")
        #expect(try !ChangeFixtures.snapshot(amount: json).changes[0].assessments[0].isExact)
    }

    @Test func anUnknownProposedModeIsNotExact() throws {
        #expect(try !ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(mode: "other")).changes[0].assessments[0].isExact)
    }

    @Test(arguments: ["[]", "[8]", "[7,8]"])
    func evidenceMustBeNonEmptyAndEveryIdAnObservation(ids: String) throws {
        #expect(try !ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(ids: ids)).changes[0].assessments[0].isExact)
    }

    @Test func aNonExactObservationAmountDisablesTheAssessment() throws {
        let observation = ChangeFixtures.observation.replacingOccurrences(of: "\"12.34\"", with: "\"12.345\"")
        let text = ChangeFixtures.body(amount: ChangeFixtures.amountJSON(), observations: observation)
        #expect(try !ChangeFixtures.parse(text).changes[0].assessments[0].isExact)
    }

    @Test func aBadOrMissingFingerprintHidesOnlyThatAssessment() throws {
        let uppercase = String(repeating: "A", count: 64)
        for bad in ["", "abc", uppercase] {
            let snapshot = try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(bad), timing: ChangeFixtures.timingJSON())
            #expect(snapshot.changes[0].assessments.map(\.dimension) == [.timing])
        }
        let noKey = #"{"state":"proposed_change","decisionState":"pending","proposedMode":"fixed","proposedAmount":"1.00","evidenceExpenseIds":[7]}"#
        #expect(try ChangeFixtures.snapshot(amount: noKey, missing: ChangeFixtures.missingJSON()).changes[0].assessments.map(\.dimension) == [.missing])
    }

    @Test func unknownStatesAndDecisionStatesAreNotShown() throws {
        let snapshot = try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(state: "something_new"),
                                                   timing: ChangeFixtures.timingJSON(decision: "dismissed"),
                                                   missing: ChangeFixtures.missingJSON("brand_new"))
        #expect(snapshot.changes[0].assessments.isEmpty && snapshot.grouped(.pending).isEmpty)
    }

    @Test func timingUsesTheSavedCadenceAndMissingKeepsItsDates() throws {
        let snapshot = try ChangeFixtures.snapshot(timing: ChangeFixtures.timingJSON(), missing: ChangeFixtures.missingJSON("not_seen_recently"))
        let assessments = snapshot.changes[0].assessments
        guard case .timing(let timing) = assessments[0].proposal else { Issue.record("not timing"); return }
        #expect(timing.cadence == "monthly" && timing.day == 20 && timing.windowAfterDays == 3)
        #expect(assessments[0].evidence.map(\.expenseId) == [7])
        guard case .missing(let state, let dates) = assessments[1].proposal else { Issue.record("not missing"); return }
        #expect(state == .notSeenRecently && dates == [CalendarDate("2026-08-15"), CalendarDate("2026-09-15")])
    }

    @Test(arguments: ["{}", "[]", "null", #"{"changes":{}}"#, #"{"changes":[{"commitment":{"id":"not-a-guid","name":"x"},"observations":[]}]}"#])
    func aMalformedTopLevelOrChangeThrows(text: String) {
        #expect(throws: CommitmentsValidation.ParseError.self) { try ChangeFixtures.parse(text) }
    }

    @Test func anObservationWithoutAPositiveIdMakesTheResponseMalformed() {
        let bad = ChangeFixtures.observation.replacingOccurrences(of: "\"expenseId\":7", with: "\"expenseId\":0")
        #expect(throws: CommitmentsValidation.ParseError.self) { try ChangeFixtures.parse(ChangeFixtures.body(observations: bad)) }
    }

    @Test func anEmptyListIsValid() throws {
        #expect(try ChangeFixtures.parse(#"{"evaluatedOn":"2026-10-01","changes":[]}"#).changes.isEmpty)
    }

    @Test func groupingMatchesTheWeb() throws {
        let snapshot = try ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(decision: "kept"), timing: ChangeFixtures.timingJSON(),
                                                   missing: ChangeFixtures.missingJSON())
        #expect(snapshot.grouped(.pending)[0].assessments.map(\.dimension) == [.timing, .missing])
        #expect(snapshot.grouped(.kept)[0].assessments.map(\.dimension) == [.amount])
        #expect(snapshot.count(.pending) == 2 && snapshot.count(.kept) == 1)
        #expect(try ChangeFixtures.snapshot().grouped(.pending).isEmpty)
    }

    @Test func actionsFollowTheState() throws {
        func decisions(_ snapshot: CommitmentChangesSnapshot) -> [ChangeDecision] { snapshot.changes[0].assessments[0].decisions }
        #expect(try decisions(ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON())) == [.accept, .keep])
        #expect(try decisions(ChangeFixtures.snapshot(timing: ChangeFixtures.timingJSON())) == [.accept, .keep])
        #expect(try decisions(ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON("possibly_ended"))) == [.markEnded, .keep])
        #expect(try decisions(ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON("not_seen_recently"))) == [.keep])
        #expect(try decisions(ChangeFixtures.snapshot(amount: ChangeFixtures.amountJSON(decision: "kept"))) == [.reconsider])
        #expect(try decisions(ChangeFixtures.snapshot(missing: ChangeFixtures.missingJSON(decision: "kept"))) == [.reconsider])
    }

    @Test func pathsFollowTheEndpoints() {
        let id = ChangeFixtures.id
        let base = "api/commitment-changes/\(id)"
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .amount, decision: .accept) == "\(base)/amount/accept")
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .timing, decision: .accept) == "\(base)/timing/accept")
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .missing, decision: .markEnded) == "\(base)/missing/mark-ended")
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .missing, decision: .keep) == "\(base)/missing/keep")
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .timing, decision: .reconsider) == "\(base)/timing/reconsider")
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .missing, decision: .accept) == nil)
        #expect(CommitmentChangePath.path(commitmentId: id, dimension: .amount, decision: .markEnded) == nil)
    }
}

@Suite struct CommitmentChangesAPITests {
    private func api(_ transport: StubTransport) -> OrdoAPI { OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    @Test func theReadIsAnAuthorizedGetWithoutABody() async throws {
        let transport = StubTransport()
        transport.route("/api/commitment-changes") { _ in StubResponse(200, json: "{}") }
        _ = try await api(transport).commitmentChanges(accessToken: "access-1")
        let request = try #require(transport.requests("/api/commitment-changes").first)
        #expect(request.httpMethod == "GET" && request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    @Test func everyDecisionIsAPostOfOnlyTheFingerprint() async throws {
        let id = ChangeFixtures.id
        let cases: [(ChangeDimension, ChangeDecision, String)] = [
            (.amount, .accept, "/api/commitment-changes/\(id)/amount/accept"),
            (.timing, .accept, "/api/commitment-changes/\(id)/timing/accept"),
            (.missing, .markEnded, "/api/commitment-changes/\(id)/missing/mark-ended"),
            (.timing, .keep, "/api/commitment-changes/\(id)/timing/keep"),
            (.missing, .reconsider, "/api/commitment-changes/\(id)/missing/reconsider")]
        for (dimension, decision, route) in cases {
            let transport = StubTransport()
            transport.route(route) { _ in StubResponse(204, Data()) }
            let path = try #require(CommitmentChangePath.path(commitmentId: id, dimension: dimension, decision: decision))
            try await api(transport).decideCommitmentChange(accessToken: "access-1", path: path,
                                                           body: CommitmentRequestBody.fingerprint(ChangeFixtures.fp))
            let request = try #require(transport.requests(route).first)
            #expect(request.httpMethod == "POST" && request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
            #expect(String(decoding: request.httpBody ?? Data(), as: UTF8.self) == #"{"fingerprint":"\#(ChangeFixtures.fp)"}"#)
        }
    }

    @Test func statusesMapLikeOtherCommitmentWrites() async {
        let id = ChangeFixtures.id
        let route = "/api/commitment-changes/\(id)/amount/keep"
        let path = "api/commitment-changes/\(id)/amount/keep"
        func result(_ response: StubResponse) async -> Outcome? {
            let transport = StubTransport()
            transport.route(route) { _ in response }
            return await RecurringViewModel.classify {
                try await api(transport).decideCommitmentChange(accessToken: "a", path: path, body: CommitmentRequestBody.fingerprint(ChangeFixtures.fp))
            }
        }
        #expect(await result(StubResponse(204, Data())) == .applied)
        #expect(await result(StubResponse(404, Data())) == .notFound)
        #expect(await result(StubResponse(409, json: #"{"code":"change_proposal_changed"}"#)) == .conflict("change_proposal_changed"))
        #expect(await result(StubResponse(400, json: #"{"code":"fingerprint_invalid"}"#)) == .refused("fingerprint_invalid"))
        #expect(await result(StubResponse(422, json: "{}")) == .refused(nil))
        #expect(await result(StubResponse(503, Data())) == .uncertain)
    }
}

private typealias Outcome = RecurringViewModel.Outcome

@Suite struct AttentionLinkTests {
    private func item(_ id: String, reviews: Int) -> CommitmentAttentionItem {
        CommitmentAttentionItem(id: id, name: "Plan \(id)", reviews: (0..<reviews).map { _ in ReviewReason(dimension: .amount, state: "proposed_change") })
    }
    private func content(_ items: [CommitmentAttentionItem], partial: Bool = false) -> SectionState<AttentionContent> {
        .available(AttentionContent(commitmentItems: items, budgetItems: [], isPartial: partial))
    }

    @Test func noLinkWithoutCommitmentItems() {
        #expect(HomePresenter.attentionLink(content([])) == nil)
        #expect(HomePresenter.attentionLink(content([], partial: true)) == nil)
    }

    @Test func openReviewsWhenEveryItemIsShown() {
        #expect(HomePresenter.attentionLink(content([item("a", reviews: 2), item("b", reviews: 1)])) == .openReviews)
        #expect(HomePresenter.attentionLink(content([item("a", reviews: 1)], partial: true)) == .openReviews)
    }

    @Test func viewAllWithTheReviewCountWhenMoreExistThanShown() {
        let link = HomePresenter.attentionLink(content([item("a", reviews: 2), item("b", reviews: 1), item("c", reviews: 3)]))
        #expect(link == .viewAll(6))
    }

    @Test func linkIsShownWhenAttentionIsUnavailableOrMalformed() {
        #expect(HomePresenter.attentionLink(.unavailable) == .openReviews)
        #expect(HomePresenter.attentionLink(.malformed) == .openReviews)
    }

    @Test func titlesComeFromTheWebKeysInBothLanguages() {
        let en = HomePresenter(l10n: L10n(language: .en), currencyCode: "USD")
        let es = HomePresenter(l10n: L10n(language: .es), currencyCode: "USD")
        #expect(en.title(for: .openReviews) == "Review recurring expenses" && es.title(for: .openReviews) == "Revisar gastos recurrentes")
        #expect(en.title(for: .viewAll(5)) == "See all 5 items to review" && en.title(for: .viewAll(1)) == "See the 1 item to review")
        #expect(es.title(for: .viewAll(5)) == "Ver los 5 elementos por revisar")
    }
}
