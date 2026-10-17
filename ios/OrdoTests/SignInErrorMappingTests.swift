import Foundation
import Testing
@testable import Ordo

@Suite struct SignInErrorMappingTests {
    @Test func mapsKnownFailures() {
        #expect(SignInErrorMapping.messageKey(for: APIError.invalidCredentials) == .authErrorsLoginInvalidCredentials)
        #expect(SignInErrorMapping.messageKey(for: APIError.emailNotConfirmed) == .authErrorsLoginEmailNotConfirmed)
        #expect(SignInErrorMapping.messageKey(for: APIError.offline) == .appOffline)
    }

    @Test func everythingElseIsTheGenericFailure() {
        for error: Error in [APIError.server(500), APIError.unauthorized, APIError.invalidResponse, SessionError.storageFailed] {
            #expect(SignInErrorMapping.messageKey(for: error) == .authErrorsLoginFailed)
        }
    }

    @Test func webCopyIsUsedVerbatim() {
        let en = L10n(language: .en)
        #expect(en.string(.authErrorsLoginInvalidCredentials) == "Incorrect email or password")
        #expect(en.string(.authErrorsLoginEmailNotConfirmed) == "Confirm your email before signing in.")
        #expect(en.string(.authErrorsLoginFailed) == "We couldn’t sign you in. Try again.")
    }

    @Test func apiMapsTheBackendCodes() async throws {
        for (fixture, expected) in [("auth-invalid-credentials", APIError.invalidCredentials),
                                    ("auth-email-not-confirmed", APIError.emailNotConfirmed)] {
            let transport = StubTransport()
            let response = try StubResponse(401, fixture: fixture)
            transport.route("/api/auth/device-sessions") { _ in response }
            let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
            await #expect(throws: expected) { try await api.createDeviceSession(email: "a@b.test", password: "x") }
        }
    }
}
