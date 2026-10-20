import SwiftUI

struct SignInView: View {
    @Bindable var model: SignInViewModel
    @Bindable var account: AccountFlowViewModel
    let notice: SignedOutReason
    let language: LanguageChoice
    let l10n: L10n
    @FocusState private var focus: Field?
    private enum Field { case email, password }

    var body: some View {
        NavigationStack(path: $account.path) {
            Form {
                if notice == .sessionEnded {
                    Section {
                        InlineStatusView(systemImage: "info.circle", message: l10n.string(.authSessionEnded), tone: .info)
                    }
                    .themedToneRow(.info)
                }
                Section {
                    TextField(l10n.string(.authFieldsEmail), text: $model.email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    HStack {
                        Group {
                            if model.showsPassword {
                                TextField(l10n.string(.authFieldsPassword), text: $model.password)
                            } else {
                                SecureField(l10n.string(.authFieldsPassword), text: $model.password)
                            }
                        }
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await model.submit() } }
                        Button {
                            model.showsPassword.toggle()
                        } label: {
                            Image(systemName: model.showsPassword ? "eye.slash" : "eye")
                        }
                        .buttonStyle(OrdoIconButtonStyle())
                        .accessibilityLabel(model.showsPassword
                            ? l10n.string(.authPasswordToggleHidePassword)
                            : l10n.string(.authPasswordToggleShowPassword))
                    }
                }
                .themedRows()
                if let key = model.errorKey {
                    Section {
                        InlineStatusView(systemImage: "exclamationmark.triangle", message: l10n.string(key), tone: .danger)
                            .accessibilityAddTraits(.isStaticText)
                    }
                    .themedToneRow(.danger)
                }
                if model.offersResend {
                    ResendSection(isSending: model.isResending, canResend: model.canResend, result: model.resendResult,
                                  l10n: l10n) { Task { await model.resendConfirmation() } }
                }
                Section {
                    Button {
                        Task { await model.submit() }
                    } label: {
                        HStack {
                            if model.isSigningIn { ProgressView() }
                            Text(verbatim: model.isSigningIn ? l10n.string(.authSigningIn) : l10n.string(.authLoginSubmit))
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(OrdoPrimaryButtonStyle())
                    .disabled(!model.canSubmit)
                }
                .themedButtonRow()
                Section {
                    Button(l10n.string(.authLoginForgotPassword)) { account.open(.forgotPassword, email: model.email) }
                        .buttonStyle(OrdoSecondaryButtonStyle())
                        .disabled(model.isSigningIn)
                    Button(l10n.string(.authLoginSwitchToRegister)) { account.open(.createAccount, email: model.email) }
                        .buttonStyle(OrdoSecondaryButtonStyle())
                        .disabled(model.isSigningIn)
                }
                .themedButtonRow()
            }
            .themedList()
            .navigationTitle(l10n.string(.authLoginTitle))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
            }
            .navigationDestination(for: AccountRoute.self) { route in
                switch route {
                case .createAccount: CreateAccountView(model: account, language: language, l10n: l10n)
                case .checkEmail: CheckEmailView(model: account, language: language, l10n: l10n)
                case .forgotPassword: ForgotPasswordView(model: account, language: language, l10n: l10n)
                }
            }
            .onChange(of: account.path) { _, _ in account.pathChanged() }
            .onChange(of: model.errorKey) { _, key in
                if let key { AccessibilityNotification.Announcement(l10n.string(key)).post() }
            }
            .onChange(of: model.resendResult) { _, result in
                if let result { AccessibilityNotification.Announcement(l10n.string(result.key)).post() }
            }
        }
    }
}
