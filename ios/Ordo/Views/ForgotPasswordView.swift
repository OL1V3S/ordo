import SwiftUI

/// Forgot password, like the web: the same message for any email. The reset link opens the web
/// page in the browser; the app never handles the token.
struct ForgotPasswordView: View {
    @Bindable var model: AccountFlowViewModel
    let language: LanguageChoice
    let l10n: L10n

    var body: some View {
        Form {
            Section {
                AccountEmailField(l10n: l10n, email: $model.email)
            } footer: {
                Text(verbatim: l10n.string(.authForgotPasswordDescription) + " " + l10n.string(.authIosLinkOpensInBrowser))
            }
            .themedRows()
            if let result = model.forgotResult {
                Section {
                    InlineStatusView(systemImage: result == .sent ? "envelope" : "exclamationmark.triangle",
                                     message: l10n.string(result.key), tone: result.tone)
                }
                .themedToneRow(result.tone)
            }
            Section {
                Button {
                    Task { await model.sendResetLink() }
                } label: {
                    HStack {
                        if model.isSendingReset { ProgressView() }
                        Text(verbatim: model.isSendingReset ? l10n.string(.authResendRequesting) : l10n.string(.authForgotPasswordSubmit))
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(OrdoPrimaryButtonStyle())
                .disabled(!model.canSendReset)
            }
            .themedButtonRow()
            Section {
                Text(verbatim: l10n.string(.authForgotPasswordRecoverySummary))
                Text(verbatim: l10n.string(.authForgotPasswordRecoveryHelp))
            }
            .themedRows()
            ResendSection(isSending: model.isResending, canResend: model.canResend, result: model.resendResult,
                          l10n: l10n) { Task { await model.resend() } }
            Section {
                Button(l10n.string(.authActionsBackToLogin)) { model.backToSignIn() }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isBusy)
            }
            .themedButtonRow()
        }
        .themedList()
        .navigationTitle(l10n.string(.authForgotPasswordTitle))
        .navigationBarBackButtonHidden(model.isBusy)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
        }
        .modifier(AnnouncedMessages(texts: [model.forgotResult.map { l10n.string($0.key) },
                                            model.resendResult.map { l10n.string($0.key) }].compactMap { $0 }))
    }
}
