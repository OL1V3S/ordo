import SwiftUI
import WidgetKit

/// The Home Screen widget (medium). This slice shows a placeholder and two buttons that open the
/// app's Add expense and Add deposit forms. It reads no account data, makes no network call and
/// never writes money.
struct OrdoCaptureWidget: Widget {
    static let kind = "OrdoCaptureWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CaptureProvider()) { _ in
            CaptureWidgetView()
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("widget.name")
        .description("widget.description")
        .supportedFamilies([.systemMedium])
    }
}

struct CaptureEntry: TimelineEntry {
    let date: Date
}

struct CaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> CaptureEntry { CaptureEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (CaptureEntry) -> Void) {
        completion(CaptureEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<CaptureEntry>) -> Void) {
        // Static content: one entry, never refreshed.
        completion(Timeline(entries: [CaptureEntry(date: .now)], policy: .never))
    }
}

struct CaptureWidgetView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("widget.placeholder")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 12) {
                CaptureButton(link: .addExpense, title: "widget.addExpense", systemImage: "minus.circle.fill")
                CaptureButton(link: .addDeposit, title: "widget.addDeposit", systemImage: "plus.circle.fill")
            }
        }
    }
}

private struct CaptureButton: View {
    let link: WidgetDeepLink
    let title: LocalizedStringKey
    let systemImage: String

    var body: some View {
        Link(destination: link.url) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .minimumScaleFactor(0.8)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.horizontal, 8)
                .background(.tint.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                .widgetAccentable()
        }
    }
}

#Preview(as: .systemMedium) {
    OrdoCaptureWidget()
} timeline: {
    CaptureEntry(date: .now)
}
