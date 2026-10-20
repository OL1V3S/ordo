import SwiftUI

/// After a registration: the link in the email opens the web page in the browser.
struct CheckEmailView: View {
    @Bindable var model: AccountFlowViewModel
    let language: LanguageChoice
    let l10n: L10n

    var body: some View {
        Form {
            if let notice = model.checkEmailNotice {
                Section {
                    switch notice {
                    case .sent:
                        InlineStatusView(systemImage: "envelope", message: l10n.string(.authCheckEmailSent, model.sentEmail), tone: .success)
                    case .deliveryFailed:
                        InlineStatusView(systemImage: "exclamationmark.triangle",
                                         message: l10n.string(.authErrorsRegistrationDeliveryFailed), tone: .warning)
                    case .outcomeUnknown:
                        InlineStatusView(systemImage: "questionmark.circle",
                                         message: l10n.string(.authRegisterIosOutcomeUnknown, model.sentEmail), tone: .warning)
                    }
                }
                .themedToneRow(notice == .sent ? .success : .warning)
            }
            Section {
                Text(verbatim: l10n.string(.authCheckEmailConfirmBefore, model.sentEmail))
                Text(verbatim: l10n.string(.authIosLinkOpensInBrowser))
            }
            .themedRows()
            ResendSection(isSending: model.isResending, canResend: model.canResend, result: model.resendResult,
                          l10n: l10n) { Task { await model.resend() } }
            Section {
                Button(l10n.string(.authActionsBackToLogin)) { model.backToSignIn() }
                    .buttonStyle(OrdoPrimaryButtonStyle())
                    .disabled(model.isBusy)
            }
            .themedButtonRow()
        }
        .themedList()
        .navigationTitle(l10n.string(.authCheckEmailTitle))
        .navigationBarBackButtonHidden(model.isBusy)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { LanguageMenu(choice: language, l10n: l10n) }
        }
        .modifier(AnnouncedMessages(texts: model.resendResult.map { [l10n.string($0.key)] } ?? []))
    }
}
