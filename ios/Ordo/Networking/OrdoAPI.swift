import Foundation

struct DeviceSessionResponse: Sendable {
    let accessToken: String
    let refreshToken: String
}

/// The only requests the app makes: the three device-session endpoints, `GET /api/home`,
/// `GET /api/activity/timeline`, the two idempotent creates `POST /api/expenses` and
/// `POST /api/inflows`, and the edits and deletes `PUT` and `DELETE` on `/api/expenses/{id}` and
/// `/api/inflows/{id}`. The edits and deletes take no `Idempotency-Key`; see `MutationRequest`.
/// The Budgets screen adds `GET /api/budgetlimits?monthYear=YYYY-MM`, the upsert
/// `POST /api/budgetlimits` and `DELETE /api/budgetlimits/{id}`; those take no `Idempotency-Key`
/// either (see `BudgetsViewModel`).
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

    // MARK: Timeline

    /// Returns the raw body; validation happens in `TimelineValidation`. Only set filters are sent
    /// and the owner is never a parameter (it comes from the token). The items are in a fixed
    /// order and percent-encoded with the RFC 3986 unreserved set, because `URLComponents` leaves
    /// `+` as it is and the server would read it as a space.
    func activityTimeline(accessToken: String, query: TimelineQuery) async throws -> Data {
        var items: [(String, String)] = [("limit", String(query.limit))]
        if let cursor = query.cursor, !cursor.isEmpty { items.append(("cursor", cursor)) }
        let search = TimelineFilterRules.trimmedSearch(query.filter.q)
        if !search.isEmpty { items.append(("q", search)) }
        if query.filter.kind != .all { items.append(("kind", query.filter.kind.rawValue)) }
        if let from = query.filter.from { items.append(("from", from.isoString)) }
        if let to = query.filter.to { items.append(("to", to.isoString)) }

        var components = URLComponents(url: baseURL.appending(path: "api/activity/timeline"), resolvingAgainstBaseURL: false)
        components?.percentEncodedQueryItems = items.map {
            URLQueryItem(name: Self.percentEncode($0.0), value: Self.percentEncode($0.1))
        }
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
        case 400: throw APIError.timelineRejected(TimelineRejection(code: Self.errorCode(in: data)))
        case 503:
            if Self.errorCode(in: data) == "activity_timeline_unavailable" { throw APIError.timelineUnavailable }
            throw APIError.server(503)
        default: throw APIError.server(status)
        }
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func percentEncode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
    }

    // MARK: Edits and deletes

    private struct ExpenseUpdateBody: Encodable {
        let amount: String
        let category: String
        let date: String
        let description: String
        let id: Int
    }

    private struct InflowUpdateBody: Encodable {
        let amount: String
        let date: String
        let description: String
        let id: Int
    }

    /// An absolute replacement of the record's values. `id` equals the route id (the server rejects
    /// a mismatch). Identical arguments always produce identical bytes, so a retry of one frozen
    /// edit sends exactly the same request.
    func updateExpense(accessToken: String, id: Int, values: CaptureValidation.FrozenValues) async throws -> MutationResult {
        let body = try Self.encode(ExpenseUpdateBody(amount: values.amount,
                                                     category: values.category ?? CaptureValidation.defaultCategory,
                                                     date: values.date, description: values.descriptionText, id: id))
        return try await mutate(method: "PUT", path: "api/expenses/\(id)", accessToken: accessToken, body: body)
    }

    func updateInflow(accessToken: String, id: Int, values: CaptureValidation.FrozenValues) async throws -> MutationResult {
        let body = try Self.encode(InflowUpdateBody(amount: values.amount, date: values.date,
                                                    description: values.descriptionText, id: id))
        return try await mutate(method: "PUT", path: "api/inflows/\(id)", accessToken: accessToken, body: body)
    }

    func deleteExpense(accessToken: String, id: Int) async throws -> MutationResult {
        try await mutate(method: "DELETE", path: "api/expenses/\(id)", accessToken: accessToken, body: nil)
    }

    func deleteInflow(accessToken: String, id: Int) async throws -> MutationResult {
        try await mutate(method: "DELETE", path: "api/inflows/\(id)", accessToken: accessToken, body: nil)
    }

    /// Status alone decides a write. Any `2xx` is applied (`204` is expected), `404` means the record
    /// is gone, a `400` on an edit names its fields by key only, and everything else is left to the
    /// caller as `.server`, which it treats as an unknown outcome.
    private func mutate(method: String, path: String, accessToken: String, body: Data?) async throws -> MutationResult {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        let (data, status) = try await send(request)
        switch status {
        case 200..<300: return .applied
        case 404: return .notFound
        case 401: throw APIError.unauthorized
        case 400 where method == "PUT":
            let fields = Self.validationFields(in: data)
            throw fields.isEmpty ? APIError.updateRejected : APIError.validationFailed(fields)
        default: throw APIError.server(status)
        }
    }

    // MARK: Budget limits

    /// Returns the raw body; validation happens in `BudgetLimitsValidation`. The month is the exact
    /// `YYYY-MM` key and the owner is never a parameter (it comes from the token).
    func budgetLimits(accessToken: String, month: BudgetMonth) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: "api/budgetlimits"), resolvingAgainstBaseURL: false)
        components?.percentEncodedQueryItems = [URLQueryItem(name: "monthYear", value: month.key)]
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
        default: throw APIError.server(status)
        }
    }

    /// The server upserts by owner, exact category and month. The body is built byte by byte (see
    /// `BudgetUpsert.requestBody`), so identical arguments always produce identical bytes.
    ///
    /// The upsert has its own status switch and does not use `mutate`: any `2xx` is applied, `400`
    /// is a validation refusal (its body is never read), `401` is unauthorised, and everything else
    /// (a `404` included) is left to the caller as `.server`, an unknown outcome.
    func upsertBudgetLimit(accessToken: String, _ upsert: BudgetUpsert) async throws -> MutationResult {
        let headers = ["Authorization": "Bearer \(accessToken)"]
        let (_, status) = try await perform(post: "api/budgetlimits", body: try upsert.requestBody(), headers: headers)
        switch status {
        case 200..<300: return .applied
        case 400: throw APIError.budgetRejected
        case 401: throw APIError.unauthorized
        default: throw APIError.server(status)
        }
    }

    /// `2xx` means deleted and `404` means the row is gone (missing, or another user's). Any other
    /// status is an unknown outcome.
    func deleteBudgetLimit(accessToken: String, id: Int) async throws -> MutationResult {
        try await mutate(method: "DELETE", path: "api/budgetlimits/\(id)", accessToken: accessToken, body: nil)
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
