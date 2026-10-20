import Foundation

enum ReceiptField: Int, Comparable, Sendable {
    case description, amount, date
    static func < (a: ReceiptField, b: ReceiptField) -> Bool { a.rawValue < b.rawValue }
}

enum ReceiptWarning: Equatable, Sendable {
    case dateOutsideWindow, amountNeedsReview, expectedAmountNeedsReview
    case differsFromFixed, expectedRangeNeedsReview, outsideRange
}

/// The "Link a deposit" form: which slot, and a new deposit or a saved one.
struct ReceiptDraft: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Source: Equatable, Sendable { case new, existing }

    var slotAnchor: CalendarDate?
    var source: Source = .new
    var descriptionText: String
    var amountText: String
    var date: CalendarDate
    var existingInflowId: Int?
    var search = ""

    var description: String { "ReceiptDraft(redacted)" }
    var debugDescription: String { description }

    /// Defaults: the schedule's name, its exact fixed amount (never a needs-review amount), the
    /// device's today and the first (current) slot.
    static func initial(for profile: PaycheckProfile, today: CalendarDate) -> ReceiptDraft {
        var amount = ""
        if case .fixed(.exact(let money)) = profile.amount { amount = money.text }
        return ReceiptDraft(slotAnchor: profile.slots.first?.anchor, descriptionText: profile.name,
                            amountText: amount, date: today)
    }
}

enum ReceiptValidation {
    struct Failure: Error, Equatable { let fields: Set<ReceiptField>; var first: ReceiptField? { fields.min() } }

    /// Same rules as Add deposit: a trimmed description of 1 to 500 UTF-16 units and an exact
    /// positive amount of at most two decimals.
    static func validateNew(_ draft: ReceiptDraft, language: AppLanguage, deviceLocale: Locale)
        -> Result<(description: String, amount: Money), Failure> {
        var invalid = Set<ReceiptField>()
        let text = CaptureValidation.normalizeDescription(draft.descriptionText)
        if !(1...CaptureValidation.maximumDescriptionUnits).contains(text.utf16.count) { invalid.insert(.description) }
        let money = AmountInput.parse(draft.amountText, language: language, deviceLocale: deviceLocale)
        if money == nil { invalid.insert(.amount) }
        guard invalid.isEmpty, let money else { return .failure(Failure(fields: invalid)) }
        return .success((text, money))
    }

    /// Advisory only, never blocking. `amount` is nil when nothing was entered. Exact cents and
    /// calendar-date comparisons.
    static func warnings(profile: PaycheckProfile, slot: PaycheckSlot?, amount: PaycheckMoney?,
                         date: CalendarDate?) -> [ReceiptWarning] {
        guard let slot else { return [] }
        var result: [ReceiptWarning] = []
        if let date, date < slot.earliest || date > slot.latest { result.append(.dateOutsideWindow) }
        guard let amount else { return result }
        guard let observed = amount.money else { return result + [.amountNeedsReview] }
        switch profile.amount {
        case .fixed(let expected):
            if let expected = expected.money {
                if expected.cents != observed.cents { result.append(.differsFromFixed) }
            } else {
                result.append(.expectedAmountNeedsReview)
            }
        case .range(let minimum, let maximum):
            if let low = minimum.money, let high = maximum.money {
                if observed.cents < low.cents || observed.cents > high.cents { result.append(.outsideRange) }
            } else {
                result.append(.expectedRangeNeedsReview)
            }
        case .unavailable:
            result.append(.expectedRangeNeedsReview)
        }
        return result
    }
}

enum LinkableDeposits {
    /// Saved deposits that no schedule has claimed (any lifecycle, any evidence kind), in server
    /// order, filtered by a case-insensitive "contains" on the trimmed search text.
    static func list(deposits: [SavedDeposit], snapshot: PaychecksSnapshot, search: String) -> [SavedDeposit] {
        let claimed = snapshot.claimedInflowIds
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return deposits.filter { deposit in
            !claimed.contains(deposit.id) && (needle.isEmpty || deposit.text.lowercased().contains(needle))
        }
    }
}
