import Foundation

/// What is wrong with a draft filter. A draft with a problem is never applied, so no request is
/// made for it, and the filters show the app's own message.
enum TimelineFilterProblem: Equatable, Sendable {
    /// The search is longer than 100 UTF-16 units after trimming.
    case search
    /// `from` is after `to`.
    case range
}

/// Port of `frontend/src/features/activity/utils/timelineFilter.js`.
enum TimelineFilterRules {
    /// Counted in UTF-16 code units, matching .NET `string.Length` and JavaScript `length`.
    static let maximumSearchUnits = 100
    static let searchDebounce: Duration = .milliseconds(300)

    static func trimmedSearch(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The filter a draft would be applied as: the search trimmed.
    static func normalize(_ filter: TimelineFilter) -> TimelineFilter {
        var normalized = filter
        normalized.q = trimmedSearch(filter.q)
        return normalized
    }

    static func validate(_ filter: TimelineFilter) -> TimelineFilterProblem? {
        if trimmedSearch(filter.q).utf16.count > maximumSearchUnits { return .search }
        if let from = filter.from, let to = filter.to, from > to { return .range }
        return nil
    }

    static func isActive(_ filter: TimelineFilter) -> Bool {
        let normalized = normalize(filter)
        return !normalized.q.isEmpty || normalized.kind != .all || normalized.from != nil || normalized.to != nil
    }

    /// Only the search text changed, so applying it is debounced. Kind and dates apply at once.
    static func isSearchOnlyChange(from applied: TimelineFilter, to next: TimelineFilter) -> Bool {
        applied.kind == next.kind && applied.from == next.from && applied.to == next.to
    }

    /// The `from`/`to` a preset fills, as inclusive device-local calendar days; nil for `custom`
    /// (the user's own dates are kept).
    static func range(for period: TimelinePeriod, today: CalendarDate) -> (from: CalendarDate?, to: CalendarDate?)? {
        switch period {
        case .all: return (nil, nil)
        case .last7: return (today.adding(days: -6), today)
        case .last30: return (today.adding(days: -29), today)
        case .thisMonth:
            return (CalendarDate(year: today.year, month: today.month, day: 1),
                    CalendarDate(year: today.year, month: today.month,
                                 day: CalendarDate.daysInMonth(year: today.year, month: today.month)))
        case .custom: return nil
        }
    }
}
