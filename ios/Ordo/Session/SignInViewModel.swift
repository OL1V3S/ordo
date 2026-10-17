import Foundation
import Observation

enum SignInErrorMapping {
    /// Known failures map to their web copy; everything else is the generic sign-in failure.
    static func messageKey(for error: Error) -> L10nKey {
        switch error {
        case APIError.invalidCredentials: .authErrorsLoginInvalidCredentials
        case APIError.emailNotConfirmed: .authErrorsLoginEmailNotConfirmed
        case APIError.offline: .appOffline
        default: .authErrorsLoginFailed
        }
    }
}

@MainActor @Observable
final class SignInViewModel {
    var email = ""
    var password = ""
    var showsPassword = false
    private(set) var isSigningIn = false
    private(set) var errorKey: L10nKey?

    private let signIn: @Sendable (String, String) async throws -> Void

    init(signIn: @escaping @Sendable (String, String) async throws -> Void) { self.signIn = signIn }

    var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty && !isSigningIn
    }

    func submit() async {
        guard canSubmit else { return }
        isSigningIn = true
        errorKey = nil
        do {
            try await signIn(email, password)
            password = ""
        } catch {
            errorKey = SignInErrorMapping.messageKey(for: error)
        }
        isSigningIn = false
    }
}
