import SwiftUI

/// An icon and text for every status, never colour alone.
struct StatusMessageView: View {
    let systemImage: String
    let message: String
    var retryTitle: String?
    var retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage).font(.title2).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(verbatim: message).multilineTextAlignment(.center)
            if let retryTitle, let retry {
                Button(retryTitle, action: retry).buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}

struct InlineStatusView: View {
    let systemImage: String
    let message: String

    var body: some View {
        Label { Text(verbatim: message) } icon: { Image(systemName: systemImage) }
            .foregroundStyle(.secondary)
            .font(.callout)
    }
}
