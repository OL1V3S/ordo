import Foundation
import Testing
@testable import Ordo

private let key = "11111111-2222-4333-8444-555555555555"

private struct Harness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    func expense() async throws -> CreateResult {
        try await api.createExpense(accessToken: "access-1", idempotencyKey: key, description: "Synthetic lunch",
                                    amount: "12.50", date: "2026-10-17", category: "food")
    }

    func inflow() async throws -> CreateResult {
        try await api.createInflow(accessToken: "access-1", idempotencyKey: key, description: "Synthetic refund",
                                   amount: "12.50", date: "2026-10-17")
    }
}

private func object(_ data: Data) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

@Suite struct CreateAPITests {
    @Test func theExpenseRequestMatchesTheContract() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in StubResponse(201) }
        #expect(try await h.expense() == .created)
        let body = try #require(h.transport.bodies("/api/expenses").first)
        let json = try object(body)
        #expect(Set(json.keys) == ["description", "amount", "date", "category"])
        #expect(json["amount"] as? String == "12.50") // a JSON string, never a number
        #expect(json["date"] as? String == "2026-10-17")
        #expect(json["category"] as? String == "food")
        #expect(json["description"] as? String == "Synthetic lunch")
    }

    @Test func theDepositRequestHasNoCategory() async throws {
        let h = Harness()
        h.transport.route("/api/inflows") { _ in StubResponse(201) }
        #expect(try await h.inflow() == .created)
        let json = try object(try #require(h.transport.bodies("/api/inflows").first))
        #expect(Set(json.keys) == ["description", "amount", "date"])
        #expect(json["amount"] as? String == "12.50")
    }

    @Test func headersCarryTheBearerTokenAndTheKey() async throws {
        let h = Harness()
        let seen = Box<URLRequest>()
        h.transport.route("/api/expenses") { request in seen.value = request; return StubResponse(201) }
        _ = try await h.expense()
        let request = try #require(seen.value)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == key)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
    }

    @Test func identicalArgumentsProduceIdenticalBytes() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in StubResponse(201) }
        _ = try await h.expense()
        _ = try await h.expense()
        let bodies = h.transport.bodies("/api/expenses")
        #expect(bodies.count == 2)
        #expect(bodies[0] == bodies[1])
    }

    @Test func status201And200AreBothSaved() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in StubResponse(201) }
        #expect(try await h.expense() == .created)
        h.transport.route("/api/expenses") { _ in StubResponse(200) }
        #expect(try await h.expense() == .replayed)
    }

    @Test func aSuccessBodyIsNotRequiredToParse() async throws {
        let h = Harness()
        h.transport.route("/api/inflows") { _ in StubResponse(201, Data("not json".utf8)) }
        #expect(try await h.inflow() == .created)
    }

    @Test func fieldKeysAreReadCaseInsensitivelyAndMessagesAreIgnored() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in try StubResponse(400, fixture: "create-validation-400") }
        await #expect(throws: APIError.validationFailed([.amount, .category])) { try await h.expense() }
    }

    @Test func aDollarPrefixIsStrippedFromKeys() {
        let data = Data(#"{"errors":{"$.amount":["x"],"$.date":["y"]}}"#.utf8)
        #expect(OrdoAPI.validationFields(in: data) == [.amount, .date])
    }

    @Test func unknownOrMissingKeysAreAGenericRejection() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in try StubResponse(400, fixture: "create-validation-unknown-400") }
        await #expect(throws: APIError.createRejected) { try await h.expense() }
        h.transport.route("/api/expenses") { _ in StubResponse(400, Data()) }
        await #expect(throws: APIError.createRejected) { try await h.expense() }
        h.transport.route("/api/expenses") { _ in try StubResponse(400, fixture: "create-key-invalid-400") }
        await #expect(throws: APIError.createRejected) { try await h.expense() }
    }

    @Test func conflictStatusesMapByCode() async throws {
        let h = Harness()
        h.transport.route("/api/inflows") { _ in try StubResponse(409, fixture: "create-record-deleted-409") }
        await #expect(throws: APIError.recordDeleted) { try await h.inflow() }
        h.transport.route("/api/inflows") { _ in try StubResponse(409, fixture: "create-conflict-409") }
        await #expect(throws: APIError.conflict) { try await h.inflow() }
        h.transport.route("/api/inflows") { _ in StubResponse(409) }
        await #expect(throws: APIError.server(409)) { try await h.inflow() }
        h.transport.route("/api/inflows") { _ in try StubResponse(422, fixture: "create-key-reused-422") }
        await #expect(throws: APIError.keyReused) { try await h.inflow() }
        h.transport.route("/api/inflows") { _ in StubResponse(422) }
        await #expect(throws: APIError.server(422)) { try await h.inflow() }
    }

    @Test func a401IsUnauthorizedAndOtherStatusesAreServerErrors() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.expense() }
        for status in [204, 500, 502, 503, 404] {
            h.transport.route("/api/expenses") { _ in StubResponse(status) }
            await #expect(throws: APIError.server(status)) { try await h.expense() }
        }
    }

    @Test func transportFailuresSurfaceAsOfflineOrInvalid() async throws {
        let h = Harness()
        h.transport.route("/api/expenses") { _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.offline) { try await h.expense() }
        h.transport.route("/api/expenses") { _ in throw URLError(.networkConnectionLost) }
        await #expect(throws: APIError.offline) { try await h.expense() }
    }
}

final class Box<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T?
    var value: T? {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}
