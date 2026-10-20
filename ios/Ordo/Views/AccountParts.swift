import SwiftUI

/// "Resend confirmation email" with its uniform result (sign-in, Check email and Forgot password).
struct ResendSection: View {
    let isSending: Bool
    let canResend: Bool
    let result: ResendResult?
    let l10n: L10n
    let resend: () -> Void

    var body: some View {
        if let result {
            Section {
                InlineStatusView(systemImage: result == .sent ? "envelope" : "exclamationmark.triangle",
                                 message: l10n.string(result.key), tone: result.tone)
            }
            .themedToneRow(result.tone)
        }
        Section {
            Button(action: resend) {
                HStack {
                    if isSending { ProgressView() }
                    Text(verbatim: isSending ? l10n.string(.authResendRequesting) : l10n.string(.authResendAction))
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(OrdoSecondaryButtonStyle())
            .disabled(!canResend)
        }
        .themedButtonRow()
    }
}

/// A password field with a show/hide button. The text is never logged or stored.
struct PasswordRow: View {
    let title: String
    @Binding var text: String
    @Binding var shows: Bool
    let showLabel: String
    let hideLabel: String

    var body: some View {
        HStack {
            Group {
                if shows {
                    TextField(title, text: $text)
                } else {
                    SecureField(title, text: $text)
                }
            }
            .textContentType(.newPassword)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            Button {
                shows.toggle()
            } label: {
                Image(systemName: shows ? "eye.slash" : "eye")
            }
            .buttonStyle(OrdoIconButtonStyle())
            .accessibilityLabel(shows ? hideLabel : showLabel)
        }
    }
}

/// The email field of the account screens.
struct AccountEmailField: View {
    let l10n: L10n
    @Binding var email: String

    var body: some View {
        TextField(l10n.string(.authFieldsEmail), text: $email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }
}

/// Messages that must be read out when they appear.
struct AnnouncedMessages: ViewModifier {
    let texts: [String]

    func body(content: Content) -> some View {
        content.onChange(of: texts) { _, texts in
            if !texts.isEmpty { AccessibilityNotification.Announcement(texts.joined(separator: "\n")).post() }
        }
    }
}
