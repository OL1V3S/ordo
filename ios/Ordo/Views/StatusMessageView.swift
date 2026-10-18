import SwiftUI

/// An icon and text for every status, never colour alone. Full-screen: centred on the canvas.
struct StatusMessageView: View {
    let systemImage: String
    let message: String
    var tone: StatusTone = .neutral
    var retryTitle: String?
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Space.s3.points) {
            Image(systemName: systemImage)
                .font(Theme.Typography.title2.font)
                .foregroundStyle(tone.foreground.color)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Theme.Typography.body.font)
                .foregroundStyle(ThemeColor.text.color)
                .multilineTextAlignment(.center)
            if let retryTitle, let retry {
                Button(retryTitle, action: retry)
                    .buttonStyle(OrdoSecondaryButtonStyle(fullWidth: false))
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}

/// A status inside a list row: icon plus text, tinted by its tone.
struct InlineStatusView: View {
    let systemImage: String
    let message: String
    var tone: StatusTone = .neutral

    var body: some View {
        Label {
            Text(verbatim: message).foregroundStyle(tone.textColor.color)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(tone.foreground.color)
        }
        .font(Theme.Typography.meta.font)
    }
}
