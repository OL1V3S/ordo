import Foundation
import Testing
@testable import Ordo

private let registerPath = "/api/auth/register"
private let resendPath = "/api/auth/resend-confirmation"
private let forgotPath = "/api/auth/forgot-password"

private func api(_ transport: StubTransport) -> OrdoAPI {
    OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
}

private func json(_ data: Data?) -> [String: String] {
    (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: String]) ?? [:]
}

private func registerError(_ response: StubResponse) async -> Error? {
    let transport = StubTransport()
    transport.route(registerPath) { _ in response }
    do { try await api(transport).register(email: "new@example.test", password: "Secret1!", language: .en); return nil } catch { return error }
}

@Suite struct AccountAPITests {
    @Test(arguments: AppLanguage.allCases)
    func registerSendsEmailPasswordAndLanguageWithNoToken(language: AppLanguage) async throws {
        let transport = StubTransport()
        transport.route(registerPath) { _ in StubResponse(200, json: #"{"message":"ok"}"#) }
        try await api(transport).register(email: "new@example.test", password: "Secret1!", language: language)
        let request = try #require(transport.requests(registerPath).first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(json(request.httpBody) == ["email": "new@example.test", "password": "Secret1!", "language": language.rawValue])
    }

    @Test(arguments: AppLanguage.allCases)
    func resendAndForgotSendEmailAndLanguage(language: AppLanguage) async throws {
        let transport = StubTransport()
        transport.route(resendPath) { _ in StubResponse(202) }
        transport.route(forgotPath) { _ in StubResponse(200) }
        try await api(transport).resendConfirmation(email: "a@example.test", language: language)
        try await api(transport).forgotPassword(email: "a@example.test", language: language)
        for path in [resendPath, forgotPath] {
            let request = try #require(transport.requests(path).first)
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(json(request.httpBody) == ["email": "a@example.test", "language": language.rawValue])
        }
    }

    @Test func registerDeliveryFailureIsReadFromTheCodeOnly() async {
        #expect(await registerError(StubResponse(503, json: #"{"code":"confirmation_email_delivery_failed","detail":"x"}"#))
            as? APIError == .confirmationDeliveryFailed)
        #expect(await registerError(StubResponse(503, json: #"{"code":"other"}"#)) as? APIError == .server(503))
    }

    @Test func registerIdentityArraysKeepServerOrderAndMarkUnknowns() async {
        let body = #"[{"code":"DuplicateEmail","description":"server text"},{"code":"PasswordTooShort"},{"code":"Surprise"},{"description":"no code"}]"#
        #expect(await registerError(StubResponse(400, json: body)) as? APIError
            == .registrationRejected([.duplicateEmail, .passwordTooShort, .unknown, .unknown]))
        #expect(await registerError(StubResponse(400, json: "[]")) as? APIError == .registrationRejected([.unknown]))
        #expect(await registerError(StubResponse(400, json: #"{"title":"Bad"}"#)) as? APIError == .registrationRejected([.unknown]))
        #expect(await registerError(StubResponse(400, json: #"[{"code":"?"}]"#)) as? APIError == .registrationRejected([.unknown]))
    }

    @Test func registerTimeoutIsAnUnknownOutcomeAndOfflineIsOffline() async {
        for code in [URLError.Code.timedOut, .networkConnectionLost] {
            let transport = StubTransport()
            transport.route(registerPath) { _ in throw URLError(code) }
            await #expect(throws: APIError.registrationOutcomeUnknown) {
                try await api(transport).register(email: "a@example.test", password: "Secret1!", language: .en)
            }
        }
        let transport = StubTransport()
        transport.route(registerPath) { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: APIError.offline) {
            try await api(transport).register(email: "a@example.test", password: "Secret1!", language: .en)
        }
        // Other requests keep treating a timeout as offline.
        let other = StubTransport()
        other.route(resendPath) { _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.offline) { try await api(other).resendConfirmation(email: "a@example.test", language: .en) }
    }

    @Test func resendAndForgotMapRateLimitAndOtherStatuses() async {
        let transport = StubTransport()
        transport.route(resendPath) { _ in StubResponse(429) }
        transport.route(forgotPath) { _ in StubResponse(500) }
        await #expect(throws: APIError.rateLimited) { try await api(transport).resendConfirmation(email: "a@example.test", language: .es) }
        await #expect(throws: APIError.server(500)) { try await api(transport).forgotPassword(email: "a@example.test", language: .es) }
        #expect(await registerError(StubResponse(500)) as? APIError == .server(500))
    }
}
