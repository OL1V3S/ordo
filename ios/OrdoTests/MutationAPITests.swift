import Foundation
import Testing
@testable import Ordo

private struct MutationHarness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    static let expenseValues = CaptureValidation.FrozenValues(amount: "12.50", descriptionText: "Synthetic lunch",
                                                              date: "2026-10-17", category: "food")
    static let depositValues = CaptureValidation.FrozenValues(amount: "20.00", descriptionText: "Synthetic refund",
                                                              date: "2026-10-16", category: nil)

    func updateExpense(id: Int = 7) async throws -> MutationResult {
        try await api.updateExpense(accessToken: "access-1", id: id, values: Self.expenseValues)
    }

    func updateInflow(id: Int = 9) async throws -> MutationResult {
        try await api.updateInflow(accessToken: "access-1", id: id, values: Self.depositValues)
    }

    func deleteExpense(id: Int = 7) async throws -> MutationResult {
        try await api.deleteExpense(accessToken: "access-1", id: id)
    }

    func deleteInflow(id: Int = 9) async throws -> MutationResult {
        try await api.deleteInflow(accessToken: "access-1", id: id)
    }
}

@Suite struct MutationAPITests {
    // MARK: Requests

    @Test func theExpenseUpdateIsAPutWithSortedKeysAndTheRouteIdInTheBody() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        #expect(try await h.updateExpense() == .applied)
        let request = try #require(h.transport.requests("/api/expenses/7").first)
        #expect(request.httpMethod == "PUT")
        let body = try #require(request.httpBody)
        #expect(String(decoding: body, as: UTF8.self)
                == #"{"amount":"12.50","category":"food","date":"2026-10-17","description":"Synthetic lunch","id":7}"#)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["amount"] as? String == "12.50") // a string, never a number
        #expect(json["id"] as? Int == 7)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func theDepositUpdateHasNoCategory() async throws {
        let h = MutationHarness()
        h.transport.route("/api/inflows/9") { _ in StubResponse(204, Data()) }
        #expect(try await h.updateInflow() == .applied)
        let request = try #require(h.transport.requests("/api/inflows/9").first)
        #expect(request.httpMethod == "PUT")
        let body = try #require(request.httpBody)
        #expect(String(decoding: body, as: UTF8.self)
                == #"{"amount":"20.00","date":"2026-10-16","description":"Synthetic refund","id":9}"#)
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func anExpenseWithoutACategorySendsUncategorizedAndNeverOther() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        let values = CaptureValidation.FrozenValues(amount: "1.00", descriptionText: "x", date: "2026-10-17", category: nil)
        _ = try await h.api.updateExpense(accessToken: "access-1", id: 7, values: values)
        let body = String(decoding: try #require(h.transport.bodies("/api/expenses/7").first), as: UTF8.self)
        #expect(body.contains(#""category":"uncategorized""#))
        #expect(!body.contains(#""category":"other""#))
    }

    @Test func theSameFrozenValuesAlwaysProduceIdenticalBytes() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        _ = try await h.updateExpense()
        _ = try await h.updateExpense()
        let bodies = h.transport.bodies("/api/expenses/7")
        #expect(bodies.count == 2 && bodies[0] == bodies[1])
    }

    @Test func aDeleteIsADeleteWithNoBodyAndNoKey() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        h.transport.route("/api/inflows/9") { _ in StubResponse(204, Data()) }
        #expect(try await h.deleteExpense() == .applied)
        #expect(try await h.deleteInflow() == .applied)
        for path in ["/api/expenses/7", "/api/inflows/9"] {
            let request = try #require(h.transport.requests(path).first)
            #expect(request.httpMethod == "DELETE")
            #expect(request.httpBody == nil)
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
            #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        }
    }

    // MARK: Statuses

    @Test(arguments: [200, 201, 204])
    func anyTwoHundredIsApplied(status: Int) async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(status, Data()) }
        #expect(try await h.updateExpense() == .applied)
        #expect(try await h.deleteExpense() == .applied)
    }

    @Test func aNotFoundIsNotFoundWithAProblemBodyAndWithAnEmptyBody() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in
            StubResponse(404, json: #"{"title":"Not Found","status":404}"#)
        }
        h.transport.route("/api/inflows/9") { _ in StubResponse(404, Data()) }
        #expect(try await h.updateExpense() == .notFound)
        #expect(try await h.deleteExpense() == .notFound)
        #expect(try await h.updateInflow() == .notFound)
        #expect(try await h.deleteInflow() == .notFound)
    }

    @Test func aBadRequestNamesItsFieldsByKeyOnly() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in try StubResponse(400, fixture: "create-validation-400") }
        await #expect(throws: APIError.validationFailed([.amount, .category])) { try await h.updateExpense() }
    }

    @Test func dollarPrefixedAndCaseInsensitiveKeysAreRecognised() async throws {
        let h = MutationHarness()
        h.transport.route("/api/inflows/9") { _ in
            StubResponse(400, json: #"{"errors":{"$.amount":["x"],"Date":["y"],"request":["z"]}}"#)
        }
        await #expect(throws: APIError.validationFailed([.amount, .date])) { try await h.updateInflow() }
    }

    @Test(arguments: [
        #""Expense ID mismatch""#,
        #"{"errors":{"request":["bad"]}}"#,
        #"{"errors":{"$.x":["bad"]}}"#,
        #"{}"#,
        "",
    ])
    func aBadRequestWithNoKnownKeyIsRejectedWithoutBeingNamed(body: String) async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(400, json: body) }
        await #expect(throws: APIError.updateRejected) { try await h.updateExpense() }
    }

    @Test func aBadRequestOnADeleteIsNotAValidationError() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in try StubResponse(400, fixture: "create-validation-400") }
        await #expect(throws: APIError.server(400)) { try await h.deleteExpense() }
    }

    @Test func a401IsUnauthorized() async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.updateExpense() }
        await #expect(throws: APIError.unauthorized) { try await h.deleteExpense() }
    }

    @Test(arguments: [403, 409, 422, 500, 502, 503])
    func everyOtherStatusIsLeftToTheCallerAsAServerError(status: Int) async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in StubResponse(status) }
        await #expect(throws: APIError.server(status)) { try await h.updateExpense() }
        await #expect(throws: APIError.server(status)) { try await h.deleteExpense() }
    }

    @Test(arguments: [URLError.timedOut, .networkConnectionLost, .notConnectedToInternet])
    func timeoutsAndLostConnectionsAreOffline(code: URLError.Code) async throws {
        let h = MutationHarness()
        h.transport.route("/api/expenses/7") { _ in throw URLError(code) }
        await #expect(throws: APIError.offline) { try await h.updateExpense() }
        await #expect(throws: APIError.offline) { try await h.deleteExpense() }
    }
}
