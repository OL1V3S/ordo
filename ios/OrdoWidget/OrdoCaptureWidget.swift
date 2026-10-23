import SwiftUI
import WidgetKit

/// The Home Screen widget (medium): this month's spending with a six-month graph, and two buttons
/// that open the app's Add expense and Add deposit forms.
///
/// It reads only the shared access-token item the app writes (never the refresh credential), never
/// refreshes, writes or deletes, never writes money, and stores no figures: amounts exist only in
/// the timeline entry built from a fresh read.
struct OrdoCaptureWidget: Widget {
    static let kind = "OrdoCaptureWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: SpendingProvider()) { entry in
            SpendingWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("widget.name")
        .description("widget.description")
        .supportedFamilies([.systemMedium])
    }
}

struct SpendingEntry: TimelineEntry {
    let date: Date
    let state: WidgetSpendingState
    /// The synthetic gallery/placeholder layout, drawn redacted. Never fetched.
    let isPlaceholder: Bool

    static func placeholder(at date: Date) -> SpendingEntry {
        SpendingEntry(date: date, state: .loaded(.synthetic(at: date)), isPlaceholder: true)
    }
}

struct SpendingProvider: TimelineProvider {
    func placeholder(in context: Context) -> SpendingEntry { .placeholder(at: .now) }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (SpendingEntry) -> Void) {
        // The gallery never fetches.
        completion(.placeholder(at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<SpendingEntry>) -> Void) {
        Task {
            let now = Date()
            let state = await Self.makeLoader().load(now: now)
            completion(Self.timeline(state: state, now: now, timeZone: .current))
        }
    }

    /// Entries every 15 minutes (so "Updated …" stays true) until the next read, which is in
    /// 45 minutes or at the next local midnight, whichever is first. The midnight entry is drawn
    /// with the date check, so last month's figures are never shown as the new month.
    static func timeline(state: WidgetSpendingState, now: Date, timeZone: TimeZone) -> Timeline<SpendingEntry> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let midnight = calendar.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0, second: 0),
                                         matchingPolicy: .nextTime) ?? now.addingTimeInterval(45 * 60)
        let reload = min(now.addingTimeInterval(45 * 60), midnight)
        var dates: [Date] = []
        var next = now
        while next < reload {
            dates.append(next)
            next = next.addingTimeInterval(15 * 60)
        }
        dates.append(reload)
        return Timeline(entries: dates.map { SpendingEntry(date: $0, state: state, isPlaceholder: false) },
                        policy: .after(reload))
    }

    private static func makeLoader() -> WidgetSpendingLoader {
        let reader = WidgetAccessLocation.load().map { WidgetAccessReader(location: $0) }
        let session = WidgetNetwork.session
        return WidgetSpendingLoader(
            baseURL: AppConfiguration.load()?.baseURL,
            readAccess: { reader?.read() },
            send: { request in
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                return (data, http.statusCode)
            },
            language: .current,
            timeZone: .current)
    }
}

/// An ephemeral session with no cache and no cookies: no token or figure is written to disk.
enum WidgetNetwork {
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()
}

extension WidgetSpending {
    /// Made-up figures for the gallery and placeholder; always drawn redacted.
    static func synthetic(at date: Date) -> WidgetSpending {
        let month = BudgetMonth.current(now: date, timeZone: .current)
        let fractions = [0.6, 0.8, 0.5, 0.9, 0.7, 0.4]
        let bars = fractions.enumerated().compactMap { index, fraction -> WidgetBar? in
            guard let bucketMonth = month.shifted(by: index - 5) else { return nil }
            return WidgetBar(month: bucketMonth, spentText: "$0,000.00", fraction: fraction, isCurrent: index == 5)
        }
        return WidgetSpending(month: month, throughDate: month.firstDay, currentSpentText: "$0,000.00", isEmpty: false,
                              bars: bars, fetchedAt: date, language: .current)
    }
}

struct SpendingWidgetView: View {
    let entry: SpendingEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            HStack(spacing: 10) {
                CaptureButton(link: .addExpense, title: "widget.addExpense", systemImage: "minus.circle.fill")
                CaptureButton(link: .addDeposit, title: "widget.addDeposit", systemImage: "plus.circle.fill")
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch entry.state {
        case .loaded(let spending) where entry.isPlaceholder:
            SpendingSummary(spending: spending, date: entry.date)
                .redacted(reason: .placeholder)
        case .loaded(let spending) where spending.isCurrent(at: entry.date, timeZone: .current):
            SpendingSummary(spending: spending, date: entry.date)
        case .loaded, .needsUpdate:
            StatusText(key: "widget.needsUpdate")
        case .signedOut:
            StatusText(key: "widget.signedOut")
        case .unavailable:
            StatusText(key: "widget.unavailable")
        case .notConfigured:
            StatusText(key: "widget.notConfigured")
        }
    }
}

private struct StatusText: View {
    let key: LocalizedStringKey

    var body: some View {
        Text(key)
            .font(.headline)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
    }
}

private struct SpendingSummary: View {
    let spending: WidgetSpending
    let date: Date

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("widget.spentThisMonth")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(spending.currentSpentText)
                    .font(.title3.weight(.bold).monospacedDigit())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .privacySensitive()
                Text(spending.isEmpty ? "widget.empty" : "widget.monthToDate")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("widget.updated \(spending.updatedText(at: date))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SpendingBars(spending: spending)
                .frame(maxWidth: .infinity)
                .privacySensitive()
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("widget.summary \(spending.currentSpentText) \(trendText)"))
    }

    /// "Oct: $12.00, Nov: $3.00, …" with the exact amounts.
    private var trendText: String {
        spending.bars.map { "\(WidgetSpending.shortMonthName($0.month, language: spending.language)): \($0.spentText)" }
            .joined(separator: ", ")
    }
}

private struct SpendingBars: View {
    let spending: WidgetSpending

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(spending.bars, id: \.month) { bar in
                VStack(spacing: 2) {
                    GeometryReader { proxy in
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(bar.isCurrent ? AnyShapeStyle(.tint) : AnyShapeStyle(.tint.opacity(0.4)))
                                .frame(height: max(2, proxy.size.height * bar.fraction))
                                .widgetAccentable()
                        }
                    }
                    Text(WidgetSpending.shortMonthName(bar.month, language: spending.language))
                        .font(.system(size: 9, weight: bar.isCurrent ? .bold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
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
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 36)
                .padding(.horizontal, 8)
                .background(.tint.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                .widgetAccentable()
        }
    }
}

#Preview(as: .systemMedium) {
    OrdoCaptureWidget()
} timeline: {
    SpendingEntry.placeholder(at: .now)
    SpendingEntry(date: .now, state: .needsUpdate, isPlaceholder: false)
}
