import SwiftUI

/// Sign in: a centred column on the canvas (the web's sign-in card). It sits in the middle when it
/// fits and scrolls at large text sizes or with the keyboard open. Autofill, focus order and submit
/// are the same as in the form it replaces.
struct SignInView: View {
    @Bindable var model: SignInViewModel
    @Bindable var account: AccountFlowViewModel
    let notice: SignedOutReason
    let language: LanguageChoice
    let l10n: L10n
    @FocusState private var focus: Field?
    @State private var showsWhatIsOrdo = false
    private enum Field { case email, password }

    var body: some View {
        NavigationStack(path: $account.path) {
            GeometryReader { proxy in
                ScrollView {
                    column
                        .frame(maxWidth: 480)
                        .padding(.horizontal, Theme.Space.s4.points)
                        .padding(.vertical, Theme.Space.s5.points)
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }
            .themedCanvas()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
            }
            .sheet(isPresented: $showsWhatIsOrdo) { WhatIsOrdoView(l10n: l10n) }
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

    private var column: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4.points) {
            VStack(alignment: .leading, spacing: Theme.Space.s1.points) {
                Text(verbatim: "ordo")
                    .font(Theme.Typography.largeTitle.font.weight(.bold))
                    .foregroundStyle(ThemeColor.accent.color)
                    .accessibilityHidden(true)
                Text(verbatim: l10n.string(.authLoginTitle))
                    .font(Theme.Typography.title2.font.weight(.semibold))
                    .foregroundStyle(ThemeColor.text.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            if notice == .sessionEnded {
                StatusBanner(tone: .info, systemImage: "info.circle", message: l10n.string(.authSessionEnded))
            }
            fields
            if let key = model.errorKey {
                StatusBanner(tone: .danger, systemImage: "exclamationmark.triangle", message: l10n.string(key))
                    .accessibilityAddTraits(.isStaticText)
            }
            if model.offersResend {
                ResendContent(isSending: model.isResending, canResend: model.canResend, result: model.resendResult,
                              l10n: l10n) { Task { await model.resendConfirmation() } }
            }
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
            VStack(spacing: Theme.Space.s2.points) {
                Button(l10n.string(.authLoginForgotPassword)) { account.open(.forgotPassword, email: model.email) }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isSigningIn)
                Button(l10n.string(.authLoginSwitchToRegister)) { account.open(.createAccount, email: model.email) }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isSigningIn)
                Button(l10n.string(.authWhatIsOrdoTitle)) { showsWhatIsOrdo = true }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isSigningIn)
            }
        }
    }

    /// Email and password in one bordered card.
    private var fields: some View {
        VStack(spacing: 0) {
            TextField(l10n.string(.authFieldsEmail), text: $model.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .email)
                .submitLabel(.next)
                .onSubmit { focus = .password }
                .frame(minHeight: Theme.Size.touchTarget)
                .padding(.horizontal, Theme.Space.s3.points)
            Rectangle().fill(ThemeColor.borderSubtle.color).frame(height: 1)
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
            .frame(minHeight: Theme.Size.touchTarget)
            .padding(.horizontal, Theme.Space.s3.points)
        }
        .font(Theme.Typography.body.font)
        .foregroundStyle(ThemeColor.text.color)
        .background(ThemeColor.surface.color, in: Theme.Radius.lg.shape)
        .overlay { Theme.Radius.lg.shape.strokeBorder(ThemeColor.border.color, lineWidth: 1) }
    }
}
