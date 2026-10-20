import Foundation
import Observation

/// The three unauthenticated account requests. No token is sent and none is returned.
protocol AccountService: Sendable {
    func register(email: String, password: String, language: AppLanguage) async throws
    func resendConfirmation(email: String, language: AppLanguage) async throws
    func forgotPassword(email: String, language: AppLanguage) async throws
}

extension OrdoAPI: AccountService {}

enum AccountRoute: Hashable, Sendable {
    case createAccount, forgotPassword, checkEmail
}

/// Create account, Check your email and Forgot password, pushed from the sign-in screen. Every
/// request is one tap (never retried). The links in the emails open the web pages in Safari, so
/// the app never handles a confirm or reset token. Passwords live only here and are cleared after a
/// submit that reaches Check email, when the screen is left and on any reset. Nothing is logged.
@MainActor @Observable
final class AccountFlowViewModel {
    var path: [AccountRoute] = []
    var email = ""
    var password = ""
    var confirmPassword = ""
    var showsPassword = false
    var showsConfirmPassword = false
    private(set) var isRegistering = false
    private(set) var registerMessages: [AccountMessage] = []
    private(set) var checkEmailNotice: CheckEmailNotice?
    /// The email Check email talks about, frozen when the registration was sent.
    private(set) var sentEmail = ""
    private(set) var isResending = false
    private(set) var resendResult: ResendResult?
    private(set) var isSendingReset = false
    private(set) var forgotResult: ForgotResult?

    @ObservationIgnored private let service: AccountService
    @ObservationIgnored private let language: @MainActor () -> AppLanguage
    @ObservationIgnored private let returnToSignIn: @MainActor (String) -> Void
    /// Bumped by every reset, so a late response from an earlier screen is ignored.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var isActive = false

    init(service: AccountService, language: @escaping @MainActor () -> AppLanguage,
         returnToSignIn: @escaping @MainActor (String) -> Void = { _ in }) {
        self.service = service
        self.language = language
        self.returnToSignIn = returnToSignIn
    }

    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// A request is on its way. The screens hide Back meanwhile, so no result is lost.
    var isBusy: Bool { isRegistering || isResending || isSendingReset }
    var canRegister: Bool { !trimmedEmail.isEmpty && !password.isEmpty && !confirmPassword.isEmpty && !isBusy }
    var canResend: Bool { !trimmedEmail.isEmpty && !isBusy }
    var canSendReset: Bool { !trimmedEmail.isEmpty && !isBusy }

    /// Opens a screen from sign-in, starting from the email typed there.
    func open(_ route: AccountRoute, email: String) {
        reset()
        isActive = true
        self.email = email
        path = [route]
    }

    // MARK: Create account

    func register() async {
        guard canRegister else { return }
        registerMessages = []
        guard password == confirmPassword else {
            registerMessages = [AccountMessage(key: .authRegisterPasswordMismatch)]
            return
        }
        let current = generation
        let email = trimmedEmail
        let password = password
        isRegistering = true
        let outcome: RegisterOutcome
        do {
            try await service.register(email: email, password: password, language: language())
            outcome = .checkEmail(.sent)
        } catch {
            outcome = AccountErrorMapping.registerOutcome(for: error, email: email)
        }
        guard current == generation else { return }
        isRegistering = false
        switch outcome {
        case .checkEmail(let notice):
            clearPasswords()
            sentEmail = email
            checkEmailNotice = notice
            resendResult = nil
            path = [.checkEmail]
        case .errors(let messages):
            registerMessages = messages
        }
    }

    // MARK: Resend and forgot password (uniform answers)

    func resend() async {
        guard canResend else { return }
        let current = generation
        isResending = true
        resendResult = nil
        let result: ResendResult
        do {
            try await service.resendConfirmation(email: trimmedEmail, language: language())
            result = .sent
        } catch {
            result = AccountErrorMapping.resendResult(for: error)
        }
        guard current == generation else { return }
        isResending = false
        resendResult = result
    }

    func sendResetLink() async {
        guard canSendReset else { return }
        let current = generation
        isSendingReset = true
        forgotResult = nil
        let result: ForgotResult
        do {
            try await service.forgotPassword(email: trimmedEmail, language: language())
            result = .sent
        } catch {
            result = .failed
        }
        guard current == generation else { return }
        isSendingReset = false
        forgotResult = result
    }

    // MARK: Leaving

    /// "Back to sign in": the email stays filled in on the sign-in screen.
    func backToSignIn() {
        path = []
        leaveFlow()
    }

    /// The navigation path changed (the system Back included). Back at sign-in, the flow ends.
    func pathChanged() {
        if path.isEmpty { leaveFlow() }
    }

    /// Create account left the screen: its passwords go.
    func createAccountDisappeared() { clearPasswords() }

    /// Clears everything and ignores any response still on its way (sign-in, sign-out, session end).
    func reset() {
        generation += 1
        isActive = false
        path = []
        email = ""
        sentEmail = ""
        clearPasswords()
        isRegistering = false
        isResending = false
        isSendingReset = false
        registerMessages = []
        checkEmailNotice = nil
        resendResult = nil
        forgotResult = nil
    }

    private func leaveFlow() {
        guard isActive else { return }
        let email = trimmedEmail
        reset()
        if !email.isEmpty { returnToSignIn(email) }
    }

    private func clearPasswords() {
        password = ""
        confirmPassword = ""
        showsPassword = false
        showsConfirmPassword = false
    }
}
