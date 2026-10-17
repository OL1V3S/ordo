import Foundation

/// Port of `frontend/src/features/home/utils/homePresentation.js`.
///
/// The envelope and Recent Activity are strict: if either is invalid the whole read is invalid.
/// Attention and Upcoming are validated per section; an invalid section is `malformed`.
/// Unknown codes count as invalid. The one deliberate difference from the web: the server's
/// sort order is not re-checked (the app computes its own display order).
enum HomeValidation {
    enum ParseError: Error, Equatable { case invalidEnvelope }

    static func parse(_ data: Data) throws -> HomeSnapshot {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: data) else { throw ParseError.invalidEnvelope }
        return try snapshot(from: root)
    }

    static func snapshot(from root: JSONValue) throws -> HomeSnapshot {
        guard root.objectValue != nil,
              let generatedAt = root["generatedAt"]?.stringValue, isTimestamp(generatedAt),
              root["currencyCode"]?.stringValue == "USD",
              let evaluations = root["evaluations"],
              let activityThrough = date(evaluations["activityThroughDate"]),
              let upcomingEvaluatedOn = date(evaluations["upcomingEvaluatedOn"]),
              let recentValue = root["recentActivity"],
              let recent = recentActivity(recentValue) else { throw ParseError.invalidEnvelope }

        let attention: SectionState<AttentionContent> = root["attention"].map {
            attentionSection($0, evaluatedOn: upcomingEvaluatedOn)
        } ?? .malformed
        let upcoming: SectionState<UpcomingContent> = root["upcoming"].map {
            upcomingSection($0, evaluatedOn: upcomingEvaluatedOn)
        } ?? .malformed

        return HomeSnapshot(currencyCode: "USD", activityThroughDate: activityThrough,
                            upcomingEvaluatedOn: upcomingEvaluatedOn, recentActivity: recent,
                            attention: attention, upcoming: upcoming)
    }

    // MARK: Primitives

    private static var uuidPattern: Regex<Substring> { /[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/ }
    private static let emptyUUID = "00000000-0000-0000-0000-000000000000"
    private static var timestampPattern: Regex<Substring> { /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/ }

    private static func date(_ value: JSONValue?) -> CalendarDate? {
        value?.stringValue.flatMap { CalendarDate($0) }
    }

    private static func isTimestamp(_ text: String) -> Bool {
        guard text.wholeMatch(of: timestampPattern) != nil else { return false }
        return CalendarDate(String(text.prefix(10))) != nil
    }

    private static func isUUID(_ text: String) -> Bool {
        text.wholeMatch(of: uuidPattern) != nil && text.lowercased() != emptyUUID
    }

    private static func isBlank(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// `{ state, reasonCode }` pair used by every availability object.
    private static func isAvailabilityPair(_ value: JSONValue?) -> Bool? {
        guard let value, value.objectValue != nil, let state = value["state"]?.stringValue else { return nil }
        if state == "available" { return value["reasonCode"].isExplicitNull ? true : nil }
        if state == "unavailable" { return value["reasonCode"]?.stringValue == "source_unavailable" ? false : nil }
        return nil
    }

    /// Returns true (available, items array present), false (unavailable, items null) or nil (invalid).
    private static func availability(_ section: JSONValue, itemsKey: String) -> Bool? {
        guard let available = isAvailabilityPair(section["availability"]) else { return nil }
        if available { return section[itemsKey]?.arrayValue != nil ? true : nil }
        return section[itemsKey].isExplicitNull ? false : nil
    }

    // MARK: Recent activity (strict)

    private static func recentActivity(_ section: JSONValue) -> RecentActivityState? {
        guard let available = availability(section, itemsKey: "items") else { return nil }
        guard available, let rows = section["items"]?.arrayValue else { return .unavailable }
        // The web does not cap recent activity in the validator; the backend caps it at 3.
        var items: [ActivityItem] = []
        for row in rows {
            guard let item = activityItem(row) else { return nil }
            items.append(item)
        }
        return .available(items)
    }

    private static func activityItem(_ value: JSONValue) -> ActivityItem? {
        guard value.objectValue != nil,
              let kindText = value["kind"]?.stringValue, let kind = ActivityItem.Kind(rawValue: kindText),
              let recordId = value["recordId"]?.integerValue, recordId > 0,
              let day = date(value["date"]),
              let amountText = value["amount"]?.stringValue, let amount = Money.parse(amountText),
              let description = value["description"]?.stringValue,
              let categoryValue = value["category"] else { return nil }
        let category: String?
        if categoryValue.isNull { category = nil }
        else if let text = categoryValue.stringValue { category = text }
        else { return nil }

        guard let paycheckValue = value["paycheck"] else { return nil }
        var linked = false
        switch kind {
        case .expense:
            guard paycheckValue.isNull else { return nil }
        case .accountInflow:
            guard category == nil else { return nil }
            if !paycheckValue.isNull {
                guard paycheckValue.objectValue != nil, paycheckValue["profileId"]?.stringValue != nil,
                      let relation = paycheckValue["relation"]?.stringValue,
                      ["confirmation_evidence", "recorded_receipt"].contains(relation) else { return nil }
                linked = true
            }
        }
        return ActivityItem(kind: kind, recordId: recordId, date: day, amount: amount,
                            description: description, category: category, paycheckLinked: linked)
    }

    // MARK: Attention

    private static let families = ["commitment_change_review", "budget_attention"]

    private static func attentionSection(_ value: JSONValue, evaluatedOn: CalendarDate) -> SectionState<AttentionContent> {
        guard value.objectValue != nil,
              date(value["evaluatedOn"]) == evaluatedOn,
              let kinds = value["kindsEvaluated"]?.arrayValue,
              let familyAvailability = value["familyAvailability"]?.objectValue,
              familyAvailability.count == families.count,
              let commitmentAvailable = isAvailabilityPair(familyAvailability[families[0]]),
              let budgetAvailable = isAvailabilityPair(familyAvailability[families[1]]),
              let topAvailable = isAvailabilityPair(value["availability"]) else { return .malformed }

        let anyAvailable = commitmentAvailable || budgetAvailable
        guard topAvailable == anyAvailable else { return .malformed }
        let expectedKinds = zip(families, [commitmentAvailable, budgetAvailable]).filter(\.1).map(\.0)
        guard kinds.compactMap(\.stringValue) == expectedKinds, kinds.count == expectedKinds.count else { return .malformed }

        let items = value["items"], budgetItems = value["budgetItems"]
        if commitmentAvailable { guard items?.arrayValue != nil else { return .malformed } }
        else { guard items.isExplicitNull else { return .malformed } }
        if budgetAvailable { guard budgetItems?.arrayValue != nil else { return .malformed } }
        else { guard budgetItems.isExplicitNull else { return .malformed } }

        guard anyAvailable else { return .unavailable }

        var commitments: [CommitmentAttentionItem] = []
        if commitmentAvailable, let rows = items?.arrayValue {
            for row in rows {
                guard let item = commitmentItem(row) else { return .malformed }
                commitments.append(item)
            }
            guard Set(commitments.map(\.id)).count == commitments.count else { return .malformed }
        }

        var budget: [BudgetAttentionItem] = []
        if budgetAvailable, let rows = budgetItems?.arrayValue {
            guard rows.count <= 2 else { return .malformed }
            for row in rows {
                guard let item = budgetItem(row) else { return .malformed }
                budget.append(item)
            }
            guard Set(budget.map(\.category)).count == budget.count else { return .malformed }
        }

        return .available(AttentionContent(commitmentItems: commitments, budgetItems: budget,
                                           isPartial: !(commitmentAvailable && budgetAvailable)))
    }

    private static func commitmentItem(_ value: JSONValue) -> CommitmentAttentionItem? {
        guard value.objectValue != nil, value["kind"]?.stringValue == "commitment_change_review",
              let id = value["commitmentId"]?.stringValue, isUUID(id),
              let name = value["commitmentName"]?.stringValue, !isBlank(name),
              let reviewValues = value["reviews"]?.arrayValue, !reviewValues.isEmpty else { return nil }
        var reviews: [ReviewReason] = []
        for review in reviewValues {
            guard let dimensionText = review["dimension"]?.stringValue,
                  let dimension = ReviewReason.Dimension(rawValue: dimensionText),
                  let state = review["state"]?.stringValue else { return nil }
            switch dimension {
            case .amount, .timing: guard state == "proposed_change" else { return nil }
            case .missing: guard ["not_seen_recently", "possibly_ended"].contains(state) else { return nil }
            }
            reviews.append(ReviewReason(dimension: dimension, state: state))
        }
        return CommitmentAttentionItem(id: id, name: name, reviews: reviews)
    }

    private static func budgetItem(_ value: JSONValue) -> BudgetAttentionItem? {
        guard value.objectValue != nil, value["kind"]?.stringValue == "budget_attention",
              let category = value["category"]?.stringValue, !category.isEmpty,
              let stateText = value["state"]?.stringValue, let state = BudgetAttentionItem.State(rawValue: stateText),
              let spentText = value["spentAmount"]?.stringValue, let spent = Money.parse(spentText),
              let limitText = value["limitAmount"]?.stringValue, let limit = Money.parse(limitText, allowZero: true)
        else { return nil }
        switch state {
        case .zeroLimitSpending: guard limit.cents == 0, spent.cents > 0 else { return nil }
        case .atLimit: guard limit.cents != 0, spent.cents == limit.cents else { return nil }
        case .overLimit: guard limit.cents != 0, spent.cents > limit.cents else { return nil }
        }
        return BudgetAttentionItem(category: category, state: state, spent: spent, limit: limit)
    }

    // MARK: Upcoming

    private static func upcomingSection(_ value: JSONValue, evaluatedOn: CalendarDate) -> SectionState<UpcomingContent> {
        guard value.objectValue != nil, let horizon = value["horizon"],
              let from = date(horizon["from"]), let through = date(horizon["through"]),
              from == evaluatedOn, through == from.adding(days: 13),
              let available = availability(value, itemsKey: "items") else { return .malformed }
        guard available, let rows = value["items"]?.arrayValue else { return .unavailable }
        guard rows.count <= 2 else { return .malformed }
        var items: [UpcomingItem] = []
        for row in rows {
            guard let item = upcomingItem(row, from: from, through: through) else { return .malformed }
            items.append(item)
        }
        return .available(UpcomingContent(from: from, through: through, items: items))
    }

    private static func upcomingItem(_ value: JSONValue, from: CalendarDate, through: CalendarDate) -> UpcomingItem? {
        guard value.objectValue != nil, value["kind"]?.stringValue == "paycheck_projection",
              let profileId = value["paycheckProfileId"]?.stringValue, isUUID(profileId),
              let name = value["displayName"]?.stringValue, !isBlank(name),
              let cadenceText = value["cadence"]?.stringValue, let cadence = UpcomingItem.Cadence(rawValue: cadenceText),
              let anchor = date(value["anchorDate"]),
              let earliest = date(value["earliestExpectedDate"]),
              let latest = date(value["latestExpectedDate"]),
              earliest <= anchor, anchor <= latest, latest >= from, earliest <= through,
              let amountValue = value["amount"], let amount = upcomingAmount(amountValue) else { return nil }
        return UpcomingItem(profileId: profileId, displayName: name, cadence: cadence, anchorDate: anchor,
                            earliestExpectedDate: earliest, latestExpectedDate: latest, amount: amount)
    }

    private static func upcomingAmount(_ value: JSONValue) -> UpcomingItem.Amount? {
        switch value["mode"]?.stringValue {
        case "fixed":
            guard let text = value["fixedAmount"]?.stringValue, let money = Money.parse(text),
                  value["minimumAmount"].isExplicitNull, value["maximumAmount"].isExplicitNull else { return nil }
            return .fixed(money)
        case "range":
            guard value["fixedAmount"].isExplicitNull,
                  let minText = value["minimumAmount"]?.stringValue, let minimum = Money.parse(minText),
                  let maxText = value["maximumAmount"]?.stringValue, let maximum = Money.parse(maxText),
                  minimum.cents < maximum.cents else { return nil }
            return .range(minimum: minimum, maximum: maximum)
        default:
            return nil
        }
    }
}
