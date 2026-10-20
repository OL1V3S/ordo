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
    private(set) var isResending = false
    private(set) var resendResult: ResendResult?

    private let signIn: @Sendable (String, String) async throws -> Void
    private let resend: (@MainActor (String) async throws -> Void)?

    init(signIn: @escaping @Sendable (String, String) async throws -> Void,
         resend: (@MainActor (String) async throws -> Void)? = nil) {
        self.signIn = signIn
        self.resend = resend
    }

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    var canSubmit: Bool {
        !trimmedEmail.isEmpty && !password.isEmpty && !isSigningIn
    }

    /// An unconfirmed email can ask for another confirmation link (same endpoint and messages as the web).
    var offersResend: Bool { errorKey == .authErrorsLoginEmailNotConfirmed && resend != nil }
    var canResend: Bool { offersResend && !trimmedEmail.isEmpty && !isResending && !isSigningIn }

    func resendConfirmation() async {
        guard canResend, let resend else { return }
        isResending = true
        resendResult = nil
        do {
            try await resend(trimmedEmail)
            resendResult = .sent
        } catch {
            resendResult = AccountErrorMapping.resendResult(for: error)
        }
        isResending = false
    }

    func submit() async {
        guard canSubmit else { return }
        isSigningIn = true
        errorKey = nil
        resendResult = nil
        do {
            try await signIn(email, password)
            password = ""
        } catch {
            errorKey = SignInErrorMapping.messageKey(for: error)
        }
        isSigningIn = false
    }
}
