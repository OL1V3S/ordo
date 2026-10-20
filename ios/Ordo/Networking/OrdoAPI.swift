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
/// The Paychecks screen adds `GET /api/paychecks`, `GET /api/inflows`, `PATCH /api/paychecks/{id}/lifecycle`,
/// `POST /api/paychecks/{id}/receipts` and `DELETE /api/paychecks/{id}/receipts/{accountInflowId}`.
/// Signed out, the account screens add `POST /api/auth/register`, `POST /api/auth/resend-confirmation`
/// and `POST /api/auth/forgot-password` (no token). Confirm-email and reset-password stay on the web.
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

    // MARK: Account (unauthenticated, no token)

    /// `POST /api/auth/register`. Registering does not sign in. A timeout or a lost connection is an
    /// unknown outcome (the account may exist); the caller never retries it.
    func register(email: String, password: String, language: AppLanguage) async throws {
        let body = try JSONEncoder().encode(["email": email, "password": password, "language": language.rawValue])
        let (data, status) = try await perform(post: "api/auth/register", body: body,
                                               ambiguous: [.timedOut, .networkConnectionLost],
                                               ambiguousError: .registrationOutcomeUnknown)
        switch status {
        case 200...299: return
        case 400: throw APIError.registrationRejected(Self.identityCodes(in: data))
        case 503 where Self.errorCode(in: data) == "confirmation_email_delivery_failed":
            throw APIError.confirmationDeliveryFailed
        default: throw APIError.server(status)
        }
    }

    /// `POST /api/auth/resend-confirmation`. The server answers the same for any email.
    func resendConfirmation(email: String, language: AppLanguage) async throws {
        try await uniformAccountPost("api/auth/resend-confirmation", email: email, language: language)
    }

    /// `POST /api/auth/forgot-password`. The server answers the same for any email.
    func forgotPassword(email: String, language: AppLanguage) async throws {
        try await uniformAccountPost("api/auth/forgot-password", email: email, language: language)
    }

    private func uniformAccountPost(_ path: String, email: String, language: AppLanguage) async throws {
        let body = try JSONEncoder().encode(["email": email, "language": language.rawValue])
        let (_, status) = try await perform(post: path, body: body)
        switch status {
        case 200...299: return
        case 429: throw APIError.rateLimited
        default: throw APIError.server(status)
        }
    }

    /// Only the string `code` of each item is read. A body that is not an array, or an empty one, is one unknown code.
    static func identityCodes(in data: Data) -> [IdentityCode] {
        guard let items = (try? JSONSerialization.jsonObject(with: data)) as? [Any], !items.isEmpty else { return [.unknown] }
        return items.map { IdentityCode(code: ($0 as? [String: Any])?["code"] as? String) }
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

    /// The cash-flow report for one month. Returns the raw body; validation happens in
    /// `CashFlowValidation`. Both query values are exact strings and the owner comes from the token.
    func cashFlow(accessToken: String, month: BudgetMonth, throughDate: CalendarDate) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: "api/analytics/cash-flow"), resolvingAgainstBaseURL: false)
        components?.percentEncodedQueryItems = [URLQueryItem(name: "month", value: month.key),
                                                URLQueryItem(name: "throughDate", value: throughDate.isoString)]
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

    // MARK: Paychecks

    func paychecks(accessToken: String) async throws -> Data { try await get("api/paychecks", accessToken: accessToken) }

    /// All saved deposits, newest first. Unbounded, as on the web.
    func inflows(accessToken: String) async throws -> Data { try await get("api/inflows", accessToken: accessToken) }

    private func get(_ path: String, accessToken: String) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: path))
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

    func updatePaycheckLifecycle(accessToken: String, id: String, body: Data) async throws {
        try await paycheckWrite(method: "PATCH", path: "api/paychecks/\(id)/lifecycle", accessToken: accessToken, body: body)
    }

    /// No `Idempotency-Key`: a repeat of the same body to the same slot is answered by the server
    /// with `200 alreadyRecorded`.
    func recordPaycheckReceipt(accessToken: String, id: String, body: Data) async throws {
        try await paycheckWrite(method: "POST", path: "api/paychecks/\(id)/receipts", accessToken: accessToken, body: body)
    }

    func removePaycheckReceipt(accessToken: String, id: String, inflowId: Int) async throws {
        try await paycheckWrite(method: "DELETE", path: "api/paychecks/\(id)/receipts/\(inflowId)",
                                accessToken: accessToken, body: nil)
    }

    /// `200` and `201` are applied (the body is not needed: the list is read again). `400` and `409`
    /// are definitive refusals that carry a `code`; `404` means the schedule is gone. Everything else
    /// (a `5xx` included) is an unknown outcome left to the caller.
    private func paycheckWrite(method: String, path: String, accessToken: String, body: Data?) async throws {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        let (data, status) = try await send(request)
        switch status {
        case 200, 201: return
        case 401: throw APIError.unauthorized
        case 404: throw APIError.paycheckNotFound
        case 400: throw APIError.paycheckRejected(Self.errorCode(in: data))
        case 409: throw APIError.paycheckConflict(Self.errorCode(in: data))
        default: throw APIError.server(status)
        }
    }

    // MARK: Recurring expenses

    func commitmentCandidates(accessToken: String) async throws -> Data {
        try await get("api/commitment-candidates", accessToken: accessToken)
    }

    func commitments(accessToken: String) async throws -> Data { try await get("api/commitments", accessToken: accessToken) }

    func dismissCandidate(accessToken: String, body: Data) async throws {
        try await commitmentWrite(method: "POST", path: "api/commitment-candidates/dismiss", accessToken: accessToken, body: body)
    }

    func reconsiderCandidate(accessToken: String, body: Data) async throws {
        try await commitmentWrite(method: "POST", path: "api/commitment-candidates/reconsider", accessToken: accessToken, body: body)
    }

    /// No `Idempotency-Key`: a repeat for the same origin fingerprint is answered with
    /// `200 alreadyConfirmed` and writes nothing.
    func confirmCandidate(accessToken: String, body: Data) async throws {
        try await commitmentWrite(method: "POST", path: "api/commitment-candidates/confirm", accessToken: accessToken, body: body)
    }

    func updateCommitmentLifecycle(accessToken: String, id: String, body: Data) async throws {
        try await commitmentWrite(method: "PATCH", path: "api/commitments/\(id)/lifecycle", accessToken: accessToken, body: body)
    }

    /// `200`, `201` and `204` are applied (the body is not needed: the lists are read again). `400`,
    /// `404`, `409` and `422` are definitive refusals (the server rolled back); everything else
    /// (a `5xx` included) is an unknown outcome left to the caller.
    private func commitmentWrite(method: String, path: String, accessToken: String, body: Data) async throws {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        let (data, status) = try await send(request)
        switch status {
        case 200, 201, 204: return
        case 401: throw APIError.unauthorized
        case 404: throw APIError.commitmentNotFound
        case 400: throw APIError.commitmentRejected(Self.errorCode(in: data))
        case 422: throw APIError.commitmentRejected(nil)
        case 409: throw APIError.commitmentConflict(Self.errorCode(in: data))
        default: throw APIError.server(status)
        }
    }

    // MARK: Statement import

    /// `204` means there is no open preview (nil). The PDF itself is never read here.
    func importOpen(accessToken: String) async throws -> Data? {
        let (data, status) = try await importRequest(method: "GET", path: "api/import-previews/open",
                                                     query: [URLQueryItem(name: "sourceType", value: "sunflower_pdf")],
                                                     accessToken: accessToken)
        return status == 204 ? nil : data
    }

    func importPreview(accessToken: String, batchId: String) async throws -> Data {
        try await importRequest(method: "GET", path: "api/import-previews/\(batchId)", accessToken: accessToken).0
    }

    /// `body` is a complete multipart body (see `MultipartBody`); the boundary must match it.
    func createImportPreview(accessToken: String, body: Data, boundary: String) async throws -> Data {
        try await importRequest(method: "POST", path: "api/import-previews", accessToken: accessToken, body: body,
                                contentType: "multipart/form-data; boundary=\(boundary)", timeout: 60).0
    }

    func updateImportRow(accessToken: String, batchId: String, rowId: String, body: Data) async throws -> Data {
        try await importRequest(method: "PATCH", path: "api/import-previews/\(batchId)/rows/\(rowId)",
                                accessToken: accessToken, body: body, contentType: "application/json").0
    }

    func updateImportSelection(accessToken: String, batchId: String, body: Data) async throws -> Data {
        try await importRequest(method: "POST", path: "api/import-previews/\(batchId)/selection",
                                accessToken: accessToken, body: body, contentType: "application/json").0
    }

    /// No body and no `Idempotency-Key`: the server locks the batch and answers a repeat with `200 already_confirmed`.
    func confirmImport(accessToken: String, batchId: String) async throws -> Data {
        try await importRequest(method: "POST", path: "api/import-previews/\(batchId)/confirm", accessToken: accessToken).0
    }

    /// `200`, `201` and `204` succeed. Any other `4xx` (`413` included, with or without a body) is a
    /// definitive refusal; `5xx` and everything unrecognised stay unknown for the caller.
    private func importRequest(method: String, path: String, query: [URLQueryItem] = [], accessToken: String,
                               body: Data? = nil, contentType: String? = nil,
                               timeout: TimeInterval = 30) async throws -> (Data, Int) {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = timeout
        let (data, status) = try await send(request)
        switch status {
        case 200, 201, 204: return (data, status)
        case 401: throw APIError.unauthorized
        case 400..<500: throw APIError.importRefused(status: status, code: Self.errorCode(in: data))
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
                         headers: [String: String] = [:], ambiguous: Set<URLError.Code> = [],
                         ambiguousError: APIError = .offline) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.timeoutInterval = timeout
        return try await send(request, ambiguous: ambiguous, ambiguousError: ambiguousError)
    }

    private func send(_ request: URLRequest, ambiguous: Set<URLError.Code> = [],
                      ambiguousError: APIError = .offline) async throws -> (Data, Int) {
        do {
            let (data, response) = try await transport.send(request)
            return (data, response.statusCode)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            if ambiguous.contains(error.code) { throw ambiguousError }
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
