import Foundation

struct DeviceSessionResponse: Sendable {
    let accessToken: String
    let refreshToken: String
}

/// The only requests the app makes: the three device-session endpoints and `GET /api/home`.
/// There are no writes to financial data.
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

    // MARK: Internals

    private func perform(post path: String, body: Data, timeout: TimeInterval = 30) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
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
