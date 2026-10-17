import Foundation

struct DeviceSessionResponse: Sendable {
    let accessToken: String
    let refreshToken: String
}

/// The only requests the app makes: the three device-session endpoints, `GET /api/home`, and
/// the two idempotent creates `POST /api/expenses` and `POST /api/inflows`.
struct OrdoAPI: Sendable {
    let baseURL: URL
    let transport: HTTPTransport

    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost,
        .cannotFindHost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed,
    ]

    func createDeviceSession(email: String, password: String) async throws -> DeviceSessionResponse {
        let body = try JSONEncoder().encode(["email": email, "password": password])
        let (data, status) = try await perform(post: "api/auth/device-sessions", body: body)
        switch status {
        case 200: return try Self.decodeSession(data)
        case 401:
            switch Self.errorCode(in: data) {
            case "invalid_credentials": throw APIError.invalidCredentials
            case "email_not_confirmed": throw APIError.emailNotConfirmed
            default: throw APIError.unauthorized
            }
        default: throw APIError.server(status)
        }
    }

    /// A refresh rotates the credential. Every 401 means the session is gone.
    func refresh(refreshToken: String) async throws -> DeviceSessionResponse {
        let body = try JSONEncoder().encode(["refreshToken": refreshToken])
        let (data, status) = try await perform(post: "api/auth/device-sessions/refresh", body: body)
        switch status {
        case 200: return try Self.decodeSession(data)
        case 401: throw APIError.sessionEnded
        default: throw APIError.server(status)
        }
    }

    /// Best effort; the caller ignores failures.
    func signOut(refreshToken: String) async throws {
        let body = try JSONEncoder().encode(["refreshToken": refreshToken])
        let (_, status) = try await perform(post: "api/auth/device-sessions/sign-out", body: body, timeout: 5)
        guard status == 204 || status == 200 else { throw APIError.server(status) }
    }

    /// Returns the raw body; validation happens in `HomeValidation`.
    func home(accessToken: String, activityThroughDate: CalendarDate) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: "api/home"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "activityThroughDate", value: activityThroughDate.isoString)]
        guard let url = components?.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        let (data, status) = try await send(request)
        switch status {
        case 200: return data
        case 401: throw APIError.unauthorized
        case 503:
            if Self.errorCode(in: data) == "home_unavailable" { throw APIError.homeUnavailable }
            throw APIError.server(503)
        default: throw APIError.server(status)
        }
    }

    // MARK: Creates

    private struct ExpenseBody: Encodable {
        let description: String
        let amount: String
        let date: String
        let category: String
    }

    private struct InflowBody: Encodable {
        let description: String
        let amount: String
        let date: String
    }

    /// `amount` is the invariant two-decimal string and `date` is `yyyy-MM-dd`. Identical
    /// arguments always produce identical bytes, so every retry of one save sends the same request.
    func createExpense(accessToken: String, idempotencyKey: String, description: String,
                       amount: String, date: String, category: String) async throws -> CreateResult {
        let body = try Self.encode(ExpenseBody(description: description, amount: amount, date: date, category: category))
        return try await create(path: "api/expenses", accessToken: accessToken, idempotencyKey: idempotencyKey, body: body)
    }

    func createInflow(accessToken: String, idempotencyKey: String, description: String,
                      amount: String, date: String) async throws -> CreateResult {
        let body = try Self.encode(InflowBody(description: description, amount: amount, date: date))
        return try await create(path: "api/inflows", accessToken: accessToken, idempotencyKey: idempotencyKey, body: body)
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    /// Status and `code` alone decide the outcome. A 2xx body is not needed: Home is re-read.
    private func create(path: String, accessToken: String, idempotencyKey: String, body: Data) async throws -> CreateResult {
        let headers = ["Authorization": "Bearer \(accessToken)", "Idempotency-Key": idempotencyKey]
        let (data, status) = try await perform(post: path, body: body, headers: headers)
        switch status {
        case 201: return .created
        case 200: return .replayed
        case 401: throw APIError.unauthorized
        case 400:
            if Self.errorCode(in: data) == "idempotency_key_invalid" { throw APIError.createRejected }
            let fields = Self.validationFields(in: data)
            throw fields.isEmpty ? APIError.createRejected : APIError.validationFailed(fields)
        case 409:
            switch Self.errorCode(in: data) {
            case "idempotency_key_record_deleted": throw APIError.recordDeleted
            case "idempotency_key_conflict": throw APIError.conflict
            default: throw APIError.server(409)
            }
        case 422:
            if Self.errorCode(in: data) == "idempotency_key_reused" { throw APIError.keyReused }
            throw APIError.server(422)
        default: throw APIError.server(status)
        }
    }

    /// Only the keys of the `errors` object are read, case-insensitively and without any `$.`
    /// prefix. Messages are never read. Unknown keys (such as `request`) are ignored.
    static func validationFields(in data: Data) -> Set<ValidationField> {
        guard let errors = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["errors"] as? [String: Any] else {
            return []
        }
        var fields = Set<ValidationField>()
        for key in errors.keys {
            var name = key.lowercased()
            if name.hasPrefix("$.") { name.removeFirst(2) }
            if let field = ValidationField(rawValue: name) { fields.insert(field) }
        }
        return fields
    }

    // MARK: Internals

    private func perform(post path: String, body: Data, timeout: TimeInterval = 30,
                         headers: [String: String] = [:]) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.timeoutInterval = timeout
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await transport.send(request)
            return (data, response.statusCode)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw Self.offlineCodes.contains(error.code) ? APIError.offline : APIError.invalidResponse
        }
    }

    private static func decodeSession(_ data: Data) throws -> DeviceSessionResponse {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String, !token.isEmpty,
              let refresh = json["refreshToken"] as? String, !refresh.isEmpty else { throw APIError.invalidResponse }
        return DeviceSessionResponse(accessToken: token, refreshToken: refresh)
    }

    /// Only a string `code` is ever read from an error body.
    static func errorCode(in data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["code"] as? String
    }
}
