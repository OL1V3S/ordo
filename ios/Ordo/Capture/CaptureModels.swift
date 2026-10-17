import Foundation

enum CaptureKind: String, Codable, Sendable {
    case expense
    case deposit
}

/// The category choices, as on the web: a fixed list plus a custom text field. There is no
/// category endpoint. `uncategorized` is the default.
enum CategoryChoice: String, CaseIterable, Sendable {
    case uncategorized, food, transport, bills, entertainment, custom

    var labelKey: L10nKey {
        switch self {
        case .uncategorized: .categoryUncategorized
        case .food: .categoryFood
        case .transport: .categoryTransport
        case .bills: .categoryBills
        case .entertainment: .categoryEntertainment
        case .custom: .categoryOther
        }
    }
}

/// Form fields, in the order the form shows them (the first invalid one gets focus).
enum CaptureField: Int, CaseIterable, Comparable, Sendable {
    case description, amount, date, category

    static func < (lhs: CaptureField, rhs: CaptureField) -> Bool { lhs.rawValue < rhs.rawValue }

    init(_ field: ValidationField) {
        switch field {
        case .description: self = .description
        case .amount: self = .amount
        case .date: self = .date
        case .category: self = .category
        }
    }
}

/// What the user is typing. It becomes a frozen `PendingSave` at the first valid Save.
struct CaptureDraft: Equatable, Sendable {
    var description = ""
    var amountText = ""
    var date: CalendarDate
    var category: CategoryChoice = .uncategorized
    var customCategory = ""
}

/// One save whose outcome is not yet definitive: the idempotency key together with the exact
/// values it was frozen with. It is immutable, so a retry can never send different values under
/// the same key. Descriptions and amounts are never printed or logged.
struct PendingSave: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    let kind: CaptureKind
    /// Lowercase canonical UUID, sent as `Idempotency-Key`.
    let key: String
    /// Invariant two-decimal text such as `"12.50"`.
    let amount: String
    let descriptionText: String
    /// Strict `yyyy-MM-dd`.
    let date: String
    /// Normalised category for an expense; nil for a deposit.
    let category: String?
    let createdAt: Date

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, kind, key, amount, date, category, createdAt
        case descriptionText = "description"
    }

    var description: String { "PendingSave(redacted)" }
    var debugDescription: String { description }

    /// True when every field has the shape the app itself writes. Anything else is unreadable.
    var isWellFormed: Bool {
        guard schemaVersion == Self.currentSchemaVersion,
              let uuid = UUID(uuidString: key), uuid.uuidString.lowercased() == key,
              Money.parse(amount) != nil, CalendarDate(date) != nil,
              descriptionText == descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
              (1...CaptureValidation.maximumDescriptionUnits).contains(descriptionText.utf16.count) else { return false }
        switch kind {
        case .deposit: return category == nil
        case .expense:
            guard let category else { return false }
            return !category.isEmpty && category != CaptureValidation.reservedCategory
                && category.utf16.count <= CaptureValidation.maximumCategoryUnits
        }
    }
}

/// Conversion between a calendar day and the `Date` a `DatePicker` uses. Both directions use a
/// Gregorian calendar in the device time zone at noon, so the day cannot shift, even when the
/// user's calendar is not Gregorian.
enum CaptureDates {
    static func date(from day: CalendarDate, timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(timeZone: timeZone, year: day.year, month: day.month,
                                                  day: day.day, hour: 12)) ?? Date(timeIntervalSince1970: 0)
    }

    static func calendarDate(from date: Date, timeZone: TimeZone) -> CalendarDate {
        DateFormatting.localCalendarDate(now: date, timeZone: timeZone)
    }
}
