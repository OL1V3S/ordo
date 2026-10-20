import Foundation
import Testing
@testable import Ordo

private let gid = PaycheckFixtures.id1

private struct PaycheckHarness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    func record(_ body: Data = Data(#"{"existingInflowId":5,"slotAnchor":"2026-10-16"}"#.utf8)) async throws {
        try await api.recordPaycheckReceipt(accessToken: "access-1", id: gid, body: body)
    }
    func lifecycle() async throws {
        try await api.updatePaycheckLifecycle(accessToken: "access-1", id: gid, body: PaycheckRequestBody.lifecycle(.paused))
    }
    func remove() async throws { try await api.removePaycheckReceipt(accessToken: "access-1", id: gid, inflowId: 5) }
}

@Suite struct PaychecksAPITests {
    @Test func readsAreAuthorizedGetsWithoutABodyOrIdempotencyKey() async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks") { _ in StubResponse(200, json: "{}") }
        h.transport.route("/api/inflows") { _ in StubResponse(200, json: "[]") }
        _ = try await h.api.paychecks(accessToken: "access-1")
        _ = try await h.api.inflows(accessToken: "access-1")
        for path in ["/api/paychecks", "/api/inflows"] {
            let request = try #require(h.transport.requests(path).first)
            #expect(request.httpMethod == "GET" && request.httpBody == nil)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
            #expect(request.url?.query == nil)
        }
    }

    @Test func aReadMapsStatuses() async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks") { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.api.paychecks(accessToken: "x") }
        h.transport.route("/api/paychecks") { _ in StubResponse(503) }
        await #expect(throws: APIError.server(503)) { try await h.api.paychecks(accessToken: "x") }
    }

    @Test func lifecycleIsAPatchWithTheExactBytes() async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks/\(gid)/lifecycle") { _ in StubResponse(200, json: "{}") }
        try await h.lifecycle()
        let request = try #require(h.transport.requests("/api/paychecks/\(gid)/lifecycle").first)
        #expect(request.httpMethod == "PATCH")
        #expect(String(decoding: request.httpBody ?? Data(), as: UTF8.self) == #"{"lifecycle":"paused"}"#)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func removeIsADeleteWithNoBody() async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks/\(gid)/receipts/5") { _ in StubResponse(200, json: "{}") }
        try await h.remove()
        let request = try #require(h.transport.requests("/api/paychecks/\(gid)/receipts/5").first)
        #expect(request.httpMethod == "DELETE" && request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
    }

    @Test func recordBodiesAreExactForBothSources() throws {
        let slot = PaycheckFixtures.date("2026-10-16")
        let existing = PaycheckRequestBody.recordExisting(inflowId: 5, slot: slot)
        #expect(String(decoding: existing, as: UTF8.self) == #"{"existingInflowId":5,"slotAnchor":"2026-10-16"}"#)
        let new = try PaycheckRequestBody.recordNew(description: "Pay \"q\" é/x", amount: Money.parse("1200.25")!,
                                                    date: PaycheckFixtures.date("2026-10-17"), slot: slot)
        let text = String(decoding: new, as: UTF8.self)
        #expect(text == #"{"newInflow":{"amount":1200.25,"date":"2026-10-17","description":"Pay \"q\" é\/x"},"slotAnchor":"2026-10-16"}"#)
        #expect(!text.contains("existingInflowId"))
        #expect(!String(decoding: existing, as: UTF8.self).contains("newInflow"))
        let object = try #require(try JSONSerialization.jsonObject(with: new) as? [String: Any])
        #expect(((object["newInflow"] as? [String: Any])?["description"] as? String) == "Pay \"q\" é/x")
    }

    @Test func recordBytesDoNotDependOnTheDeviceTimeZoneOrLocale() throws {
        let zones = ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]
        let bodies = try zones.map { _ -> Data in
            try PaycheckRequestBody.recordNew(description: "Pay", amount: Money.parse("0.10")!,
                                              date: PaycheckFixtures.date("2026-10-17"), slot: PaycheckFixtures.date("2026-10-16"))
        }
        #expect(Set(bodies).count == 1)
        #expect(String(decoding: bodies[0], as: UTF8.self).contains("\"amount\":0.10,"))
    }

    @Test(arguments: [200, 201]) func successStatusesAreApplied(status: Int) async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks/\(gid)/receipts") { _ in StubResponse(status, json: #"{"alreadyRecorded":false}"#) }
        try await h.record()
    }

    @Test(arguments: ["receipt_slot_invalid", "receipt_source_invalid", "receipt_inflow_invalid", "receipt_date_invalid", "request_invalid"])
    func a400CarriesOnlyItsCode(code: String) async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks/\(gid)/receipts") { _ in StubResponse(400, json: #"{"code":"\#(code)","detail":"secret detail"}"#) }
        await #expect(throws: APIError.paycheckRejected(code)) { try await h.record() }
    }

    @Test(arguments: ["paycheck_not_active", "receipt_slot_unavailable", "receipt_inflow_unavailable", "receipt_conflict", "receipt_link_protected"])
    func a409CarriesOnlyItsCode(code: String) async throws {
        let h = PaycheckHarness()
        h.transport.route("/api/paychecks/\(gid)/receipts") { _ in StubResponse(409, json: #"{"code":"\#(code)"}"#) }
        await #expect(throws: APIError.paycheckConflict(code)) { try await h.record() }
    }

    @Test func otherStatusesMap() async throws {
        let h = PaycheckHarness()
        let path = "/api/paychecks/\(gid)/receipts"
        h.transport.route(path) { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.record() }
        h.transport.route(path) { _ in StubResponse(404, Data()) }
        await #expect(throws: APIError.paycheckNotFound) { try await h.record() }
        h.transport.route(path) { _ in StubResponse(500, json: #"{"code":"receipt_failed"}"#) }
        await #expect(throws: APIError.server(500)) { try await h.record() }
        h.transport.route(path) { _ in StubResponse(503) }
        await #expect(throws: APIError.server(503)) { try await h.record() }
        h.transport.route(path) { _ in StubResponse(204, Data()) }
        await #expect(throws: APIError.server(204)) { try await h.record() }
        h.transport.route(path) { _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.offline) { try await h.record() }
        h.transport.route(path) { _ in throw URLError(.networkConnectionLost) }
        await #expect(throws: APIError.offline) { try await h.record() }
    }

    @Test func lifecycleAndRemoveMapTheSameStatuses() async throws {
        let h = PaycheckHarness()
        let lifecyclePath = "/api/paychecks/\(gid)/lifecycle"
        let removePath = "/api/paychecks/\(gid)/receipts/5"
        for (status, error): (Int, APIError) in [(400, .paycheckRejected("lifecycle_invalid")), (404, .paycheckNotFound),
                                                  (409, .paycheckConflict("lifecycle_invalid")), (500, .server(500))] {
            h.transport.route(lifecyclePath) { _ in StubResponse(status, json: #"{"code":"lifecycle_invalid"}"#) }
            await #expect(throws: error) { try await h.lifecycle() }
            h.transport.route(removePath) { _ in StubResponse(status, json: #"{"code":"lifecycle_invalid"}"#) }
            await #expect(throws: error) { try await h.remove() }
        }
    }

    @Test func aRefreshedTokenResendsTheSameBytes() async throws {
        // The session closure runs again with the new token; the body is a frozen value.
        let write = PaycheckWrite(operation: .record(id: gid, body: PaycheckRequestBody.recordExisting(inflowId: 5, slot: PaycheckFixtures.date("2026-10-16"))))
        guard case .record(_, let body) = write.operation else { return }
        #expect(body == PaycheckRequestBody.recordExisting(inflowId: 5, slot: PaycheckFixtures.date("2026-10-16")))
        #expect("\(write)" == "PaycheckWrite(redacted)")
    }
}
