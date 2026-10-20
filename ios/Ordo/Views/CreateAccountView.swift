import SwiftUI

/// Create account, like the web's register form. Only a password mismatch is checked here; the
/// server's Identity codes decide the rest. Registering does not sign in.
struct CreateAccountView: View {
    @Bindable var model: AccountFlowViewModel
    let language: LanguageChoice
    let l10n: L10n

    private static let requirements: [L10nKey] = [
        .authRegisterRequirementsLength, .authRegisterRequirementsUpper, .authRegisterRequirementsLower,
        .authRegisterRequirementsDigit, .authRegisterRequirementsSpecial,
    ]

    var body: some View {
        Form {
            Section {
                AccountEmailField(l10n: l10n, email: $model.email)
                PasswordRow(title: l10n.string(.authFieldsPassword), text: $model.password, shows: $model.showsPassword,
                            showLabel: l10n.string(.authPasswordToggleShowPassword),
                            hideLabel: l10n.string(.authPasswordToggleHidePassword))
                PasswordRow(title: l10n.string(.authFieldsConfirmPassword), text: $model.confirmPassword,
                            shows: $model.showsConfirmPassword,
                            showLabel: l10n.string(.authPasswordToggleShowConfirmPassword),
                            hideLabel: l10n.string(.authPasswordToggleHideConfirmPassword))
            }
            .themedRows()
            Section {
                ForEach(Self.requirements, id: \.self) { key in
                    Text(verbatim: l10n.string(key))
                }
            } header: {
                Text(verbatim: l10n.string(.authRegisterRequirementsTitle)).themedSectionHeader()
            }
            .themedRows()
            if !model.registerMessages.isEmpty {
                Section {
                    ForEach(model.registerMessages, id: \.key) { message in
                        InlineStatusView(systemImage: "exclamationmark.triangle", message: message.text(l10n), tone: .danger)
                    }
                }
                .themedToneRow(.danger)
            }
            Section {
                Button {
                    Task { await model.register() }
                } label: {
                    HStack {
                        if model.isRegistering { ProgressView() }
                        Text(verbatim: model.isRegistering ? l10n.string(.authRegisterIosCreating) : l10n.string(.authRegisterSubmit))
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canRegister)
                Button(l10n.string(.authRegisterSwitchToLogin)) { model.backToSignIn() }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isBusy)
            }
            .themedButtonRow()
        }
        .themedList()
        .navigationTitle(l10n.string(.authRegisterTitle))
        // A request on its way keeps the screen, so its answer is never lost.
        .navigationBarBackButtonHidden(model.isBusy)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
        }
        .modifier(AnnouncedMessages(texts: model.registerMessages.map { $0.text(l10n) }))
        .onDisappear { model.createAccountDisappeared() }
    }
}
