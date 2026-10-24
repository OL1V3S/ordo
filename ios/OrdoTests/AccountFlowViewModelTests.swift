import Foundation
import Testing
@testable import Ordo

@MainActor private final class Flow {
    let service: ScriptedAccountService
    var language: AppLanguage = .en
    var returned: [String] = []
    private(set) var model: AccountFlowViewModel!

    init(_ steps: [ScriptedAccountService.Step] = [{}]) {
        service = ScriptedAccountService(steps)
        model = AccountFlowViewModel(service: service, language: { [unowned self] in self.language },
                                     returnToSignIn: { [unowned self] in self.returned.append($0) })
    }

    func fillRegister(_ password: String = "Secret1!", confirm: String? = nil) {
        model.open(.createAccount, email: " new@example.test ")
        model.password = password
        model.confirmPassword = confirm ?? password
    }
}

@MainActor @Suite struct AccountFlowViewModelTests {
    @Test func aMismatchSendsNothing() async {
        let flow = Flow()
        flow.fillRegister(confirm: "Other1!")
        await flow.model.register()
        #expect(flow.service.calls.isEmpty)
        #expect(flow.model.registerMessages == [AccountMessage(key: .authRegisterPasswordMismatch)])
        #expect(flow.model.path == [.createAccount])
    }

    @Test func successGoesToCheckEmailAndClearsBothPasswords() async {
        let flow = Flow()
        flow.language = .es
        flow.fillRegister()
        await flow.model.register()
        #expect(flow.service.calls == [.register("new@example.test", "Secret1!", .es)])
        #expect(flow.model.path == [.checkEmail])
        #expect(flow.model.checkEmailNotice == .sent)
        #expect(flow.model.sentEmail == "new@example.test")
        #expect(flow.model.password.isEmpty && flow.model.confirmPassword.isEmpty)
        #expect(!flow.model.isBusy)
    }

    @Test func aDoubleTapSendsOnce() async {
        let gate = Gate()
        let flow = Flow([{ await gate.wait() }])
        flow.fillRegister()
        let first = Task { await flow.model.register() }
        #expect(await waitUntil { await MainActor.run { flow.model.isRegistering } })
        #expect(!flow.model.canRegister)
        await flow.model.register()
        await gate.release()
        await first.value
        #expect(flow.service.calls.count == 1)
    }

    @Test func deliveryFailureAndTimeoutGoToCheckEmailWithoutAFalseSuccess() async {
        for (error, notice) in [(APIError.confirmationDeliveryFailed, CheckEmailNotice.deliveryFailed),
                                (.registrationOutcomeUnknown, .outcomeUnknown)] {
            let flow = Flow([{ throw error }])
            flow.fillRegister()
            await flow.model.register()
            #expect(flow.model.checkEmailNotice == notice)
            #expect(flow.model.path == [.checkEmail])
            #expect(flow.model.password.isEmpty && flow.model.confirmPassword.isEmpty)
            // Never retried automatically; Resend and Back to sign in stay available.
            #expect(flow.service.calls.count == 1)
            #expect(flow.model.canResend)
        }
    }

    @Test func identityCodesMapToTheWebWhitelistDedupedInOrder() async {
        let flow = Flow([{ throw APIError.registrationRejected([.duplicateEmail, .passwordTooShort, .duplicateEmail, .unknown]) }])
        flow.fillRegister()
        await flow.model.register()
        #expect(flow.model.registerMessages == [
            AccountMessage(key: .authErrorsIdentityDuplicateEmail, email: "new@example.test"),
            AccountMessage(key: .authErrorsIdentityPasswordTooShort),
            AccountMessage(key: .authErrorsRegistrationFailed),
        ])
        #expect(flow.model.path == [.createAccount])
        #expect(AccountErrorMapping.identityMessages([], email: "x") == [AccountMessage(key: .authErrorsRegistrationFailed)])
        #expect(AccountErrorMapping.identityMessages([.passwordRequiresDigit], email: "x") == [AccountMessage(key: .authErrorsIdentityPasswordRequiresDigit)])
    }

    @Test func offlineAndOtherFailuresStayOnTheForm() {
        #expect(AccountErrorMapping.registerOutcome(for: APIError.offline, email: "x") == .errors([AccountMessage(key: .appOffline)]))
        #expect(AccountErrorMapping.registerOutcome(for: APIError.server(500), email: "x") == .errors([AccountMessage(key: .authErrorsGeneric)]))
        #expect(AccountErrorMapping.registerOutcome(for: APIError.rateLimited, email: "x") == .errors([AccountMessage(key: .authResendRateLimited)]))
        #expect(AccountErrorMapping.registerOutcome(for: APIError.invalidResponse, email: "x") == .errors([AccountMessage(key: .authErrorsGeneric)]))
    }

    @Test func resendIsUniformAndRateLimitIsItsOwnMessage() async {
        let flow = Flow([{}, { throw APIError.rateLimited }, { throw APIError.server(400) }, { throw APIError.offline }])
        flow.model.open(.forgotPassword, email: "a@example.test")
        var results: [ResendResult?] = []
        for _ in 0..<4 { await flow.model.resend(); results.append(flow.model.resendResult) }
        #expect(results == [.sent, .rateLimited, .failed, .failed])
        #expect(flow.service.calls.allSatisfy { $0 == .resend("a@example.test", .en) })
    }

    @Test func forgotIsUniformAndAnyFailureIsTheSameMessage() async {
        let flow = Flow([{}, { throw APIError.rateLimited }, { throw APIError.offline }])
        flow.model.open(.forgotPassword, email: "a@example.test")
        flow.language = .es
        var results: [ForgotResult?] = []
        for _ in 0..<3 { await flow.model.sendResetLink(); results.append(flow.model.forgotResult) }
        #expect(results == [.sent, .failed, .failed])
        #expect(flow.service.calls.allSatisfy { $0 == .forgot("a@example.test", .es) })
    }

    @Test func emptyEmailDisablesEveryRequest() async {
        let flow = Flow()
        flow.model.open(.forgotPassword, email: "  ")
        #expect(!flow.model.canResend && !flow.model.canSendReset)
        await flow.model.resend()
        await flow.model.sendResetLink()
        #expect(flow.service.calls.isEmpty)
    }

    @Test func backToSignInKeepsTheEmailAndClearsEverything() async {
        let flow = Flow([{ throw APIError.registrationRejected([.passwordTooShort]) }])
        flow.fillRegister()
        await flow.model.register()
        flow.model.backToSignIn()
        #expect(flow.returned == ["new@example.test"])
        #expect(flow.model.path.isEmpty && flow.model.password.isEmpty && flow.model.registerMessages.isEmpty)
        flow.model.pathChanged() // the onChange that follows does not hand the email back again
        #expect(flow.returned.count == 1)
    }

    @Test func leavingCreateAccountClearsPasswords() {
        let flow = Flow()
        flow.fillRegister()
        flow.model.createAccountDisappeared()
        #expect(flow.model.password.isEmpty && flow.model.confirmPassword.isEmpty)
    }

    @Test func aLateResponseAfterAResetIsIgnoredAndNothingStaysBusy() async {
        let gate = Gate()
        let flow = Flow([{ await gate.wait() }])
        flow.fillRegister()
        let pending = Task { await flow.model.register() }
        #expect(await waitUntil { await MainActor.run { flow.model.isRegistering } })
        flow.model.reset()
        #expect(!flow.model.isBusy)
        await gate.release()
        await pending.value
        #expect(flow.model.path.isEmpty && flow.model.checkEmailNotice == nil && !flow.model.isBusy)
    }
}

@MainActor @Suite struct SignInResendTests {
    @Test func resendIsOfferedOnlyForAnUnconfirmedEmail() async {
        let calls = Cell<[String]>([])
        let model = SignInViewModel(signIn: { _, _ in throw APIError.emailNotConfirmed },
                                    resend: { email in calls.value.append(email) })
        #expect(!model.offersResend)
        model.email = " a@example.test "
        model.password = "x"
        await model.submit()
        #expect(model.offersResend && model.canResend)
        await model.resendConfirmation()
        #expect(model.resendResult == .sent && calls.value == ["a@example.test"])
        let other = SignInViewModel(signIn: { _, _ in throw APIError.invalidCredentials }, resend: { _ in })
        other.email = "a@example.test"; other.password = "x"
        await other.submit()
        #expect(!other.offersResend)
    }

    @Test func aRateLimitedResendSaysSo() async {
        let model = SignInViewModel(signIn: { _, _ in throw APIError.emailNotConfirmed },
                                    resend: { _ in throw APIError.rateLimited })
        model.email = "a@example.test"; model.password = "x"
        await model.submit()
        await model.resendConfirmation()
        #expect(model.resendResult == .rateLimited && !model.isResending)
    }
}
