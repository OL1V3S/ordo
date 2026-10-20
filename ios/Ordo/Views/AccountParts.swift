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

/// "Password must include:" with one rule per line. VoiceOver reads it as one group: the heading,
/// then each rule; the bullet glyphs are decoration.
struct PasswordRequirementsList: View {
    let title: String
    let rules: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2.points) {
            Text(verbatim: title)
                .font(Theme.Typography.rowTitle.font)
                .foregroundStyle(ThemeColor.text.color)
                .accessibilityAddTraits(.isHeader)
            ForEach(rules, id: \.self) { rule in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2.points) {
                    Text(verbatim: "\u{2022}").accessibilityHidden(true)
                    Text(verbatim: rule).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// The resend result and button without a list section, for a disclosure or a plain layout.
struct ResendContent: View {
    let isSending: Bool
    let canResend: Bool
    let result: ResendResult?
    let l10n: L10n
    let resend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3.points) {
            if let result {
                StatusBanner(tone: result.tone, systemImage: result == .sent ? "envelope" : "exclamationmark.triangle",
                             message: l10n.string(result.key))
            }
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
    }
}
