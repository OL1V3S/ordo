import Foundation
import Testing
@testable import Ordo

private let limitsPath = "/api/budgetlimits"

private struct BudgetHarness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    static let october = BudgetMonth(year: 2026, month: 10)!

    static func upsert(_ category: String = "food", _ limit: String = "12.50",
                       month: BudgetMonth = october) -> BudgetUpsert {
        BudgetUpsert(category: category, limit: Money.parse(limit, allowZero: true)!, month: month)
    }

    func read(_ month: BudgetMonth = october) async throws -> Data {
        try await api.budgetLimits(accessToken: "access-1", month: month)
    }

    func save(_ upsert: BudgetUpsert = BudgetHarness.upsert()) async throws -> MutationResult {
        try await api.upsertBudgetLimit(accessToken: "access-1", upsert)
    }

    func delete(id: Int = 7) async throws -> MutationResult {
        try await api.deleteBudgetLimit(accessToken: "access-1", id: id)
    }

    func body() throws -> String {
        String(decoding: try #require(transport.bodies(limitsPath).last), as: UTF8.self)
    }
}

@Suite struct BudgetLimitsAPITests {
    // MARK: Read

    @Test func theReadIsAnAuthorizedGetWithTheExactMonthKeyAndNoOwner() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200, json: "[]") }
        _ = try await h.read()
        let request = try #require(h.transport.requests(limitsPath).first)
        #expect(request.httpMethod == "GET")
        #expect(request.httpBody == nil)
        #expect(request.url?.query(percentEncoded: true) == "monthYear=2026-10")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func theMonthKeyIsZeroPaddedForEveryMonthAndYear() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200, json: "[]") }
        _ = try await h.read(BudgetMonth(year: 2026, month: 3)!)
        _ = try await h.read(BudgetMonth(year: 1, month: 1)!)
        let queries = h.transport.requests(limitsPath).map { $0.url?.query(percentEncoded: true) }
        #expect(queries == ["monthYear=2026-03", "monthYear=0001-01"])
    }

    @Test func aReadReturnsTheRawBodyOn200() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200, json: "[{\"id\":1}]") }
        #expect(String(decoding: try await h.read(), as: UTF8.self) == "[{\"id\":1}]")
    }

    @Test func aReadMapsA401ToUnauthorizedAndEverythingElseToAServerError() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.read() }
        for status in [400, 404, 500, 503] {
            h.transport.route(limitsPath) { _ in StubResponse(status, json: #""Invalid monthYear format. Expected format: YYYY-MM""#) }
            await #expect(throws: APIError.server(status)) { try await h.read() }
        }
    }

    // MARK: Upsert bytes

    @Test func theUpsertBodyIsExactlyTheCategoryTheLimitAndTheMonth() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        _ = try await h.save()
        #expect(try h.body() == #"{"category":"food","limitAmount":12.50,"monthYear":"2026-10-01"}"#)
        let request = try #require(h.transport.requests(limitsPath).first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func aZeroLimitIsSentAsAJSONNumberZero() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        _ = try await h.save(BudgetHarness.upsert("bills", "0.00"))
        #expect(try h.body() == #"{"category":"bills","limitAmount":0.00,"monthYear":"2026-10-01"}"#)
    }

    @Test(arguments: ["0.01", "12.50", "100.00", "70368744177663.99", "9999999999999999.99"])
    func theLimitIsAJSONNumberWhoseTextIsTheExactMoneyText(limit: String) async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        _ = try await h.save(BudgetHarness.upsert("food", limit))
        let body = try h.body()
        #expect(body == "{\"category\":\"food\",\"limitAmount\":\(limit),\"monthYear\":\"2026-10-01\"}")
        // The raw number text is on the wire; a double never went through the encoder.
        let json = try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        #expect(json["limitAmount"] is NSNumber)
        #expect(Set(json.keys) == ["category", "limitAmount", "monthYear"])
    }

    @Test func aCustomCategoryIsEscapedByTheJSONEncoder() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        let category = "caf\u{e9} \"club\" \\ \u{1F355}\n"
        _ = try await h.save(BudgetHarness.upsert(category))
        let body = try h.body()
        #expect(body.hasPrefix(#"{"category":"café \"club\" \\ 🍕\n","limitAmount":"#))
        let json = try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        #expect(json["category"] as? String == category)
        #expect(json["monthYear"] as? String == "2026-10-01")
    }

    @Test func noIdUserIdOrUserIsEverSent() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        _ = try await h.save()
        let body = try h.body()
        for name in ["\"id\"", "userId", "\"user\""] { #expect(!body.contains(name)) }
    }

    @Test func theMonthIsAlwaysADateOnlyStringWithNoTimeOrOffset() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        for (year, month, wire) in [(2026, 10, "2026-10-01"), (2026, 1, "2026-01-01"), (2026, 12, "2026-12-01"), (1, 1, "0001-01-01")] {
            _ = try await h.save(BudgetHarness.upsert("food", "1.00", month: BudgetMonth(year: year, month: month)!))
            let body = try h.body()
            #expect(body.contains("\"monthYear\":\"\(wire)\""))
            #expect(!body.contains("T") && !body.contains("Z") && !body.contains("+"))
        }
    }

    @Test func theSameUpsertAlwaysProducesIdenticalBytesOnAnyDeviceTimeZone() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(200) }
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }
        for id in ["Pacific/Kiritimati", "America/Los_Angeles", "UTC", "Europe/Madrid"] {
            NSTimeZone.default = TimeZone(identifier: id)!
            _ = try await h.save()
        }
        let bodies = h.transport.bodies(limitsPath)
        #expect(bodies.count == 4 && Set(bodies).count == 1)
    }

    // MARK: Upsert results

    @Test(arguments: [200, 201, 204])
    func anyTwoHundredIsApplied(status: Int) async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(status, Data()) }
        #expect(try await h.save() == .applied)
    }

    @Test(arguments: [
        #""Category is required.""#,
        #"{"errors":{"$.limitAmount":["The JSON value could not be converted."]},"status":400}"#,
        "",
    ])
    func a400IsAValidationRefusalWhateverItsBody(body: String) async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(400, json: body) }
        await #expect(throws: APIError.budgetRejected) { try await h.save() }
    }

    @Test func a401IsUnauthorized() async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.save() }
    }

    @Test(arguments: [403, 404, 409, 422, 500, 502, 503])
    func everyOtherStatusIsAnUnknownOutcome(status: Int) async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in StubResponse(status, json: #"{"title":"x","status":\#(status)}"#) }
        await #expect(throws: APIError.server(status)) { try await h.save() }
    }

    @Test(arguments: [URLError.timedOut, .networkConnectionLost, .notConnectedToInternet])
    func timeoutsAndLostConnectionsAreOffline(code: URLError.Code) async throws {
        let h = BudgetHarness()
        h.transport.route(limitsPath) { _ in throw URLError(code) }
        await #expect(throws: APIError.offline) { try await h.save() }
        await #expect(throws: APIError.offline) { try await h.delete() }
    }

    // MARK: Delete

    @Test func aDeleteIsADeleteOfTheRowIdWithNoBody() async throws {
        let h = BudgetHarness()
        h.transport.route("/api/budgetlimits/7") { _ in StubResponse(204, Data()) }
        #expect(try await h.delete() == .applied)
        let request = try #require(h.transport.requests("/api/budgetlimits/7").first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func aDeleteNotFoundMeansGoneWithAProblemBodyAndWithAnEmptyBody() async throws {
        let h = BudgetHarness()
        h.transport.route("/api/budgetlimits/7") { _ in StubResponse(404, json: #"{"title":"Not Found","status":404}"#) }
        #expect(try await h.delete() == .notFound)
        h.transport.route("/api/budgetlimits/7") { _ in StubResponse(404, Data()) }
        #expect(try await h.delete() == .notFound)
    }

    @Test func aDelete401IsUnauthorizedAndOtherStatusesAreUnknownOutcomes() async throws {
        let h = BudgetHarness()
        h.transport.route("/api/budgetlimits/7") { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.delete() }
        for status in [400, 403, 409, 500, 503] {
            h.transport.route("/api/budgetlimits/7") { _ in StubResponse(status) }
            await #expect(throws: APIError.server(status)) { try await h.delete() }
        }
    }
}
