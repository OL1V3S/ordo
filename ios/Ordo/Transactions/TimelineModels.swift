import Foundation

/// What the timeline shows for an amount. A stored amount that is not a positive exact amount (a
/// legacy zero or negative, for example) is never repaired: the stored text is shown as it is,
/// next to "Exact amount unavailable".
enum TimelineAmount: Equatable, Sendable {
    case exact(Money)
    case needsReview(String)
}

/// One row of `GET /api/activity/timeline`. Descriptions, amounts and ids are never printed or
/// logged.
struct TimelineItem: Equatable, Sendable, Identifiable, CustomStringConvertible, CustomDebugStringConvertible {
    typealias Kind = ActivityItem.Kind

    let kind: Kind
    let recordId: Int
    let date: CalendarDate
    let amount: TimelineAmount
    let descriptionText: String
    /// The stored category of an expense; nil for a deposit.
    let category: String?
    let paycheckLinked: Bool

    /// `kind:recordId`, the same key the web uses to drop repeated rows.
    var id: String { "\(kind.rawValue):\(recordId)" }

    var captureKind: CaptureKind { kind == .expense ? .expense : .deposit }

    var description: String { "TimelineItem(redacted)" }
    var debugDescription: String { description }
}

/// A validated page of the timeline.
struct TimelinePage: Equatable, Sendable {
    let items: [TimelineItem]
    let limit: Int
    let hasMore: Bool
    let nextCursor: String?
}

/// The `kind` filter. `all` sends no parameter.
enum TimelineKindFilter: String, CaseIterable, Sendable {
    case all
    case expense
    case accountInflow = "account_inflow"
}

/// The filters the timeline is read with. `q` holds the text as typed in a draft and the trimmed
/// text in an applied filter. Search text is never printed or logged.
struct TimelineFilter: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    var q = ""
    var kind: TimelineKindFilter = .all
    var from: CalendarDate?
    var to: CalendarDate?

    var description: String { "TimelineFilter(redacted)" }
    var debugDescription: String { description }
}

/// The period presets, as on the web. They only fill `from` and `to`; they are not part of the
/// request.
enum TimelinePeriod: String, CaseIterable, Sendable {
    case all, last7, last30, thisMonth, custom

    var labelKey: L10nKey {
        switch self {
        case .all: .timelineFiltersPeriodAll
        case .last7: .timelineFiltersPeriodLast7
        case .last30: .timelineFiltersPeriodLast30
        case .thisMonth: .timelineFiltersPeriodThisMonth
        case .custom: .timelineFiltersPeriodCustom
        }
    }
}

/// One timeline read: always a page size and the applied filter, plus the cursor from a previous
/// page when loading more.
struct TimelineQuery: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    static let pageSize = 25

    var limit = TimelineQuery.pageSize
    var cursor: String?
    var filter = TimelineFilter()

    var description: String { "TimelineQuery(redacted)" }
    var debugDescription: String { description }
}

/// Why the server refused a timeline read (`400`), read from its `code` only.
enum TimelineRejection: Equatable, Sendable {
    case search, kind, date, cursor, limit, other

    init(code: String?) {
        switch code {
        case "activity_timeline_search_invalid": self = .search
        case "activity_timeline_kind_invalid": self = .kind
        case "activity_timeline_date_invalid": self = .date
        case "activity_timeline_cursor_invalid": self = .cursor
        case "activity_timeline_limit_invalid": self = .limit
        default: self = .other
        }
    }

    /// The rejection is about a filter, so the app shows its own filter message.
    var isFilter: Bool { self == .search || self == .kind || self == .date }
}
