import Foundation

/// Port of `isActivityTimelinePage` / `isTimelineItem` in
/// `frontend/src/features/activity/utils/timelinePresentation.js`.
///
/// The page is strict: a single violation makes the whole page malformed and no row is shown. The
/// one softness is the amount: a stored amount that is not a positive exact amount degrades only
/// that row to `needsReview`. Nothing is repaired.
enum TimelineValidation {
    enum ParseError: Error, Equatable { case malformed }

    private static let maximumPageLimit = 100

    static func parse(_ data: Data) throws -> TimelinePage {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: data),
              root.objectValue != nil,
              root["currencyCode"]?.stringValue == "USD",
              let rows = root["items"]?.arrayValue,
              let page = root["page"], page.objectValue != nil,
              let limit = page["limit"]?.integerValue, (1...maximumPageLimit).contains(limit),
              let hasMore = boolean(page["hasMore"]),
              rows.count <= limit else { throw ParseError.malformed }

        let nextCursor: String?
        if hasMore {
            guard let cursor = page["nextCursor"]?.stringValue, !cursor.isEmpty else { throw ParseError.malformed }
            nextCursor = cursor
        } else {
            guard page["nextCursor"].isExplicitNull else { throw ParseError.malformed }
            nextCursor = nil
        }

        var items: [TimelineItem] = []
        items.reserveCapacity(rows.count)
        for row in rows {
            guard let item = item(row) else { throw ParseError.malformed }
            items.append(item)
        }
        return TimelinePage(items: items, limit: limit, hasMore: hasMore, nextCursor: nextCursor)
    }

    private static func boolean(_ value: JSONValue?) -> Bool? {
        if case .bool(let flag) = value { return flag }
        return nil
    }

    private static func item(_ value: JSONValue) -> TimelineItem? {
        guard value.objectValue != nil,
              let kindText = value["kind"]?.stringValue, let kind = TimelineItem.Kind(rawValue: kindText),
              let recordId = value["recordId"]?.integerValue, recordId > 0,
              let day = value["date"]?.stringValue.flatMap({ CalendarDate($0) }),
              let amountText = value["amount"]?.stringValue, isStoredAmount(amountText),
              let description = value["description"]?.stringValue,
              let categoryValue = value["category"], let paycheckValue = value["paycheck"] else { return nil }

        let category: String?
        var linked = false
        switch kind {
        case .expense:
            // The `paycheck` key must be present, as an explicit null.
            guard let text = categoryValue.stringValue, paycheckValue.isNull else { return nil }
            category = text
        case .accountInflow:
            guard categoryValue.isNull else { return nil }
            category = nil
            if !paycheckValue.isNull {
                guard paycheckValue.objectValue != nil,
                      let profileId = paycheckValue["profileId"]?.stringValue, !profileId.isEmpty,
                      let relation = paycheckValue["relation"]?.stringValue,
                      ["confirmation_evidence", "recorded_receipt"].contains(relation) else { return nil }
                linked = true
            }
        }

        let amount: TimelineAmount = Money.parse(amountText).map(TimelineAmount.exact) ?? .needsReview(amountText)
        return TimelineItem(kind: kind, recordId: recordId, date: day, amount: amount,
                            descriptionText: description, category: category, paycheckLinked: linked)
    }

    /// `^-?\d+\.\d{2}$` with ASCII digits only.
    private static func isStoredAmount(_ text: String) -> Bool {
        var bytes = Array(text.utf8)
        if bytes.first == 0x2D { bytes.removeFirst() }
        guard bytes.count >= 4, bytes[bytes.count - 3] == 0x2E else { return false }
        return bytes.enumerated().allSatisfy { index, byte in
            index == bytes.count - 3 || (byte >= 0x30 && byte <= 0x39)
        }
    }
}
