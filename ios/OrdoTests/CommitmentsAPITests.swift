import Foundation
import Testing
@testable import Ordo

private let gid = RecurringFixtures.id1
private let print1 = RecurringFixtures.fp1

private struct CommitmentHarness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }
    var body: Data { CommitmentRequestBody.fingerprint(print1) }

    func dismiss() async throws { try await api.dismissCandidate(accessToken: "access-1", body: body) }
    func reconsider() async throws { try await api.reconsiderCandidate(accessToken: "access-1", body: body) }
    func confirm(_ data: Data? = nil) async throws { try await api.confirmCandidate(accessToken: "access-1", body: data ?? body) }
    func update(_ data: Data) async throws { try await api.updateCommitment(accessToken: "access-1", id: gid, body: data) }
    func lifecycle() async throws {
        try await api.updateCommitmentLifecycle(accessToken: "access-1", id: gid, body: CommitmentRequestBody.lifecycle(.paused))
    }
}

@Suite struct CommitmentsAPITests {
    private func values(cadence: String = "monthly", kind: String = "dayofmonth", weekday: String? = nil, day: Int? = 15, month: Int? = nil,
                        mode: String = "fixed", expected: String? = "12.34", minimum: String? = nil, maximum: String? = nil,
                        name: String = "Synthetic Streaming") -> CommitmentRequestBody.Confirm {
        CommitmentRequestBody.Confirm(name: name, category: "bills", cadence: cadence, timingKind: kind, dayOfWeek: weekday, day: day,
                                      month: month, windowBeforeDays: 1, windowAfterDays: 2, amountMode: mode,
                                      expectedAmount: expected.flatMap { Money.parse($0) }, minimumAmount: minimum.flatMap { Money.parse($0) },
                                      maximumAmount: maximum.flatMap { Money.parse($0) })
    }

    private func text(_ data: Data) -> String { String(decoding: data, as: UTF8.self) }

    @Test func readsAreAuthorizedGetsWithoutABodyOrIdempotencyKey() async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates") { _ in StubResponse(200, json: "{}") }
        h.transport.route("/api/commitments") { _ in StubResponse(200, json: "[]") }
        _ = try await h.api.commitmentCandidates(accessToken: "access-1")
        _ = try await h.api.commitments(accessToken: "access-1")
        for path in ["/api/commitment-candidates", "/api/commitments"] {
            let request = try #require(h.transport.requests(path).first)
            #expect(request.httpMethod == "GET" && request.httpBody == nil && request.url?.query == nil)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
        }
    }

    @Test func dismissAndReconsiderArePostsWithTheExactBytes() async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/dismiss") { _ in StubResponse(204, Data()) }
        h.transport.route("/api/commitment-candidates/reconsider") { _ in StubResponse(204, Data()) }
        try await h.dismiss()
        try await h.reconsider()
        for path in ["/api/commitment-candidates/dismiss", "/api/commitment-candidates/reconsider"] {
            let request = try #require(h.transport.requests(path).first)
            #expect(request.httpMethod == "POST" && request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
            #expect(text(request.httpBody ?? Data()) == #"{"fingerprint":"\#(print1)"}"#)
        }
    }

    @Test func lifecycleIsAPatchWithTheExactBytes() async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitments/\(gid)/lifecycle") { _ in StubResponse(200, json: "{}") }
        try await h.lifecycle()
        let request = try #require(h.transport.requests("/api/commitments/\(gid)/lifecycle").first)
        #expect(request.httpMethod == "PATCH" && text(request.httpBody ?? Data()) == #"{"lifecycle":"paused"}"#)
    }

    @Test func confirmBodiesAreExactForEveryTimingShape() throws {
        let fingerprint = print1
        let fixed = try CommitmentRequestBody.confirm(fingerprint: fingerprint, values())
        #expect(text(fixed) == #"{"amountMode":"fixed","cadence":"monthly","category":"bills","expectedAmount":12.34,"expectedDay":15,"expectedDayOfWeek":null,"expectedMaximumAmount":null,"expectedMinimumAmount":null,"expectedMonth":null,"fingerprint":"\#(fingerprint)","name":"Synthetic Streaming","timingKind":"dayofmonth","windowAfterDays":2,"windowBeforeDays":1}"#)
        let weekly = try CommitmentRequestBody.confirm(fingerprint: fingerprint, values(cadence: "weekly", kind: "weekday", weekday: "friday", day: nil))
        #expect(text(weekly).contains(#""expectedDay":null,"expectedDayOfWeek":"friday""#) && text(weekly).contains(#""timingKind":"weekday""#))
        let monthEnd = try CommitmentRequestBody.confirm(fingerprint: fingerprint, values(kind: "monthend", day: nil))
        #expect(text(monthEnd).contains(#""expectedDay":null"#) && text(monthEnd).contains(#""timingKind":"monthend""#))
        let yearly = try CommitmentRequestBody.confirm(fingerprint: fingerprint, values(cadence: "yearly", kind: "monthandday", day: 29, month: 2))
        #expect(text(yearly).contains(#""expectedDay":29"#) && text(yearly).contains(#""expectedMonth":2"#))
        let range = try CommitmentRequestBody.confirm(fingerprint: fingerprint, values(mode: "range", expected: nil, minimum: "10.00", maximum: "14.50"))
        #expect(text(range).contains(#""expectedAmount":null"#) && text(range).contains(#""expectedMaximumAmount":14.50"#)
                && text(range).contains(#""expectedMinimumAmount":10.00"#) && text(range).contains(#""amountMode":"range""#))
    }

    @Test func amountsAreJSONNumbersNotStrings() throws {
        let body = try CommitmentRequestBody.confirm(fingerprint: print1, values(expected: "1234567890123456.78"))
        #expect(text(body).contains(#""expectedAmount":1234567890123456.78,"#))
        #expect(!text(body).contains(#""expectedAmount":""#))
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(object["expectedAmount"] is NSNumber && !(object["expectedAmount"] is String))
    }

    @Test func namesAreEscapedAndTheBytesAreStable() throws {
        let tricky = "Pay \"q\" é/x \u{1F600}"
        let first = try CommitmentRequestBody.confirm(fingerprint: print1, values(name: tricky))
        let second = try CommitmentRequestBody.confirm(fingerprint: print1, values(name: tricky))
        #expect(first == second)
        let object = try #require(try JSONSerialization.jsonObject(with: first) as? [String: Any])
        #expect(object["name"] as? String == tricky)
    }

    @Test func aConfirmIsAPostWithoutAnIdempotencyKey() async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/confirm") { _ in StubResponse(201, json: #"{"alreadyConfirmed":false}"#) }
        let body = try CommitmentRequestBody.confirm(fingerprint: print1, values())
        try await h.confirm(body)
        let request = try #require(h.transport.requests("/api/commitment-candidates/confirm").first)
        #expect(request.httpMethod == "POST" && request.httpBody == body)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test(arguments: [200, 201, 204]) func successStatusesAreApplied(status: Int) async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/confirm") { _ in StubResponse(status, json: #"{"alreadyConfirmed":true}"#) }
        try await h.confirm()
    }

    @Test(arguments: ["fingerprint_invalid", "name_invalid", "category_invalid", "cadence_invalid", "timing_invalid", "amount_invalid"])
    func a400CarriesOnlyItsCode(code: String) async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/confirm") { _ in StubResponse(400, json: #"{"code":"\#(code)","detail":"secret detail"}"#) }
        await #expect(throws: APIError.commitmentRejected(code)) { try await h.confirm() }
    }

    @Test func a400WithoutACodeIsRejectedWithNone() async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/confirm") { _ in StubResponse(400, json: #"{"title":"One or more validation errors"}"#) }
        await #expect(throws: APIError.commitmentRejected(nil)) { try await h.confirm() }
    }

    @Test(arguments: ["candidate_changed", "candidate_dismissed", "confirmation_conflict"])
    func a409CarriesOnlyItsCode(code: String) async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitment-candidates/confirm") { _ in StubResponse(409, json: #"{"code":"\#(code)"}"#) }
        await #expect(throws: APIError.commitmentConflict(code)) { try await h.confirm() }
    }

    @Test func otherStatusesMap() async throws {
        let h = CommitmentHarness()
        let path = "/api/commitment-candidates/confirm"
        h.transport.route(path) { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.confirm() }
        h.transport.route(path) { _ in StubResponse(404, json: #"{"code":"commitment_not_found"}"#) }
        await #expect(throws: APIError.commitmentNotFound) { try await h.confirm() }
        h.transport.route(path) { _ in StubResponse(422, json: #"{"code":"anything"}"#) }
        await #expect(throws: APIError.commitmentRejected(nil)) { try await h.confirm() }
        for status in [500, 503, 418, 202] {
            h.transport.route(path) { _ in StubResponse(status) }
            await #expect(throws: APIError.server(status)) { try await h.confirm() }
        }
        h.transport.route(path) { _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.offline) { try await h.confirm() }
        h.transport.route(path) { _ in throw URLError(.networkConnectionLost) }
        await #expect(throws: APIError.offline) { try await h.confirm() }
    }

    @Test func dismissReconsiderAndLifecycleMapTheSameStatuses() async throws {
        let h = CommitmentHarness()
        for (status, error): (Int, APIError) in [(400, .commitmentRejected("fingerprint_invalid")), (409, .commitmentConflict("fingerprint_invalid")),
                                                  (404, .commitmentNotFound), (500, .server(500))] {
            for path in ["/api/commitment-candidates/dismiss", "/api/commitment-candidates/reconsider", "/api/commitments/\(gid)/lifecycle"] {
                h.transport.route(path) { _ in StubResponse(status, json: #"{"code":"fingerprint_invalid"}"#) }
            }
            await #expect(throws: error) { try await h.dismiss() }
            await #expect(throws: error) { try await h.reconsider() }
            await #expect(throws: error) { try await h.lifecycle() }
        }
    }

    @Test func confirmBytesDoNotDependOnTheDeviceTimeZoneOrLocale() throws {
        let bodies = try ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"].map { _ in
            try CommitmentRequestBody.confirm(fingerprint: print1, values(expected: "0.10"))
        }
        #expect(Set(bodies).count == 1 && text(bodies[0]).contains(#""expectedAmount":0.10,"#))
    }

    @Test func updateIsAPutWithTheConfirmBytesMinusTheFingerprint() async throws {
        let h = CommitmentHarness()
        let path = "/api/commitments/\(gid)"
        h.transport.route(path) { _ in StubResponse(200, json: #"{"unexpected":"shape"}"#) }
        let body = try CommitmentRequestBody.update(values())
        try await h.update(body)
        let request = try #require(h.transport.requests(path).first)
        #expect(request.httpMethod == "PUT" && request.httpBody == body && request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(text(body) == #"{"amountMode":"fixed","cadence":"monthly","category":"bills","expectedAmount":12.34,"expectedDay":15,"expectedDayOfWeek":null,"expectedMaximumAmount":null,"expectedMinimumAmount":null,"expectedMonth":null,"name":"Synthetic Streaming","timingKind":"dayofmonth","windowAfterDays":2,"windowBeforeDays":1}"#)
        let confirm = try CommitmentRequestBody.confirm(fingerprint: print1, values())
        #expect(text(confirm).replacingOccurrences(of: #""fingerprint":"\#(print1)","#, with: "") == text(body))
    }

    @Test(arguments: [200, 201, 204]) func updateSuccessDoesNotNeedTheResponseBody(status: Int) async throws {
        let h = CommitmentHarness()
        h.transport.route("/api/commitments/\(gid)") { _ in StubResponse(status, json: "not json") }
        try await h.update(try CommitmentRequestBody.update(values()))
    }

    @Test func updateMapsRefusalsAndUnknownOutcomes() async throws {
        let h = CommitmentHarness()
        let path = "/api/commitments/\(gid)"
        let body = try CommitmentRequestBody.update(values())
        for (status, error): (Int, APIError) in [(400, .commitmentRejected("amount_invalid")), (422, .commitmentRejected(nil)),
                                                  (404, .commitmentNotFound), (409, .commitmentConflict("amount_invalid")),
                                                  (401, .unauthorized), (500, .server(500))] {
            h.transport.route(path) { _ in StubResponse(status, json: #"{"code":"amount_invalid"}"#) }
            await #expect(throws: error) { try await h.update(body) }
        }
        h.transport.route(path) { _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.offline) { try await h.update(body) }
    }
}
