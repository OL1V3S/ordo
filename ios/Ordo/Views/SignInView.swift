import SwiftUI

struct SignInView: View {
    @Bindable var model: SignInViewModel
    let notice: SignedOutReason
    let l10n: L10n
    @FocusState private var focus: Field?
    private enum Field { case email, password }

    var body: some View {
        NavigationStack {
            Form {
                if notice == .sessionEnded {
                    Section { InlineStatusView(systemImage: "info.circle", message: l10n.string(.authSessionEnded)) }
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
                        .buttonStyle(.borderless)
                        .accessibilityLabel(model.showsPassword
                            ? l10n.string(.authPasswordToggleHidePassword)
                            : l10n.string(.authPasswordToggleShowPassword))
                    }
                }
                if let key = model.errorKey {
                    Section {
                        InlineStatusView(systemImage: "exclamationmark.triangle", message: l10n.string(key))
                            .accessibilityAddTraits(.isStaticText)
                    }
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
                    .disabled(!model.canSubmit)
                }
            }
            .navigationTitle(l10n.string(.authLoginTitle))
            .onChange(of: model.errorKey) { _, key in
                if let key { AccessibilityNotification.Announcement(l10n.string(key)).post() }
            }
        }
    }
}
