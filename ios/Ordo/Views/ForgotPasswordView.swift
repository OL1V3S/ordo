import SwiftUI

/// Forgot password, like the web: the same message for any email. The reset link opens the web
/// page in the browser; the app never handles the token.
struct ForgotPasswordView: View {
    @Bindable var model: AccountFlowViewModel
    let language: LanguageChoice
    let l10n: L10n

    var body: some View {
        Form {
            // The heading is in the body, not the large navigation title: a title does not wrap, so
            // the long text was cut off at large text sizes.
            Section {
                VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
                    Text(verbatim: l10n.string(.authForgotPasswordTitle))
                        .font(Theme.Typography.title.font.weight(.semibold))
                        .foregroundStyle(ThemeColor.text.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: l10n.string(.authForgotPasswordDescription))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.textMuted.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: Theme.Space.s1.points, bottom: 0, trailing: Theme.Space.s1.points))
            Section {
                AccountEmailField(l10n: l10n, email: $model.email)
            }
            .themedRows()
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
            } footer: {
                Text(verbatim: l10n.string(.authIosLinkOpensInBrowser))
            }
            .themedButtonRow()
            if let result = model.forgotResult {
                Section {
                    InlineStatusView(systemImage: result == .sent ? "envelope" : "exclamationmark.triangle",
                                     message: l10n.string(result.key), tone: result.tone)
                }
                .themedToneRow(result.tone)
            }
            Section {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
                        Text(verbatim: l10n.string(.authForgotPasswordRecoveryHelp))
                            .font(Theme.Typography.meta.font)
                            .foregroundStyle(ThemeColor.textMuted.color)
                        ResendContent(isSending: model.isResending, canResend: model.canResend, result: model.resendResult,
                                      l10n: l10n) { Task { await model.resend() } }
                    }
                    .padding(.top, Theme.Space.s2.points)
                } label: {
                    Text(verbatim: l10n.string(.authForgotPasswordRecoverySummary))
                        .font(Theme.Typography.body.font)
                        .foregroundStyle(ThemeColor.text.color)
                }
            }
            .themedRows()
            Section {
                Button(l10n.string(.authActionsBackToLogin)) { model.backToSignIn() }
                    .buttonStyle(OrdoSecondaryButtonStyle())
                    .disabled(model.isBusy)
            }
            .themedButtonRow()
        }
        .themedList()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.isBusy)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
        }
        .modifier(AnnouncedMessages(texts: [model.forgotResult.map { l10n.string($0.key) },
                                            model.resendResult.map { l10n.string($0.key) }].compactMap { $0 }))
    }
}
