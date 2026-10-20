import Foundation

enum ConfirmField: Int, Comparable, Sendable, CaseIterable {
    case name, category, timing, amount
    static func < (a: ConfirmField, b: ConfirmField) -> Bool { a.rawValue < b.rawValue }
}

/// The "Review and confirm" form, a port of the web's `CommitmentForm` for a candidate.
struct ConfirmDraft: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Cadence: String, CaseIterable, Sendable { case weekly, monthly, yearly }
    enum MonthlyTiming: String, CaseIterable, Sendable { case dayofmonth, monthend }
    enum AmountMode: String, CaseIterable, Sendable { case fixed, range }

    static let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    static let maximumName = 500
    static let maximumCategory = 100

    let fingerprint: String
    var name: String
    var category: String
    var cadence: Cadence
    var weekday: String
    var monthlyTiming: MonthlyTiming
    var monthText: String
    var dayText: String
    var beforeText: String
    var afterText: String
    var amountMode: AmountMode
    var expectedText: String
    var minimumText: String
    var maximumText: String
    /// An observed amount the server sent could not be read exactly: Confirm stays disabled and no
    /// amount is pre-filled from it.
    let observedUnsafe: Bool

    var description: String { "ConfirmDraft(redacted)" }
    var debugDescription: String { description }

    /// The web's `initialForm`: everything prefilled from the candidate, amounts only when exact.
    static func initial(for candidate: RecurringCandidate) -> ConfirmDraft {
        let cadence = Cadence(rawValue: candidate.timing.cadence) ?? .monthly
        let unsafe = candidate.observedFixed ? candidate.median.money == nil
            : (candidate.minimum.money == nil || candidate.maximum.money == nil)
        func text(_ money: CommitmentMoney) -> String { money.money?.text ?? "" }
        return ConfirmDraft(
            fingerprint: candidate.fingerprint, name: candidate.name, category: candidate.category, cadence: cadence,
            weekday: weekdays.contains(candidate.timing.dayOfWeek ?? "") ? candidate.timing.dayOfWeek! : "monday",
            monthlyTiming: candidate.timing.kind == "monthend" ? .monthend : .dayofmonth,
            monthText: candidate.timing.month.map(String.init) ?? "",
            dayText: candidate.timing.day.map(String.init) ?? "",
            beforeText: String(candidate.timing.windowBeforeDays ?? 0),
            afterText: String(candidate.timing.windowAfterDays ?? 0),
            amountMode: candidate.observedFixed ? .fixed : .range,
            expectedText: candidate.observedFixed ? text(candidate.median) : "",
            minimumText: text(candidate.minimum), maximumText: text(candidate.maximum), observedUnsafe: unsafe)
    }

    /// Changing the cadence resets the timing exactly as the web's `updateCadence`.
    mutating func setCadence(_ value: Cadence) {
        cadence = value
        switch value {
        case .weekly:
            if !Self.weekdays.contains(weekday) { weekday = "monday" }
            dayText = ""
            monthText = ""
        case .yearly:
            monthlyTiming = .dayofmonth
            if dayText.isEmpty { dayText = "1" }
            if monthText.isEmpty { monthText = "1" }
        case .monthly:
            monthlyTiming = .dayofmonth
            if dayText.isEmpty { dayText = "1" }
            monthText = ""
        }
    }

    var showsDay: Bool { cadence == .yearly || (cadence == .monthly && monthlyTiming == .dayofmonth) }

    struct Failure: Error, Equatable { let fields: Set<ConfirmField> }

    struct Values: Equatable, Sendable {
        let body: CommitmentRequestBody.Confirm
    }

    /// Whole numbers only (ASCII digits), at most `Int32.max` so the server's binding cannot fail.
    static func integer(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 10, trimmed.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              let value = Int(trimmed), value <= Int(Int32.max) else { return nil }
        return value
    }

    /// The web's HTML constraints plus the two server rules it leaves to the server (range maximum
    /// at least the minimum; a yearly day that exists in that month, February 29 allowed).
    func validate(language: AppLanguage, deviceLocale: Locale) -> Result<Values, Failure> {
        var fields = Set<ConfirmField>()
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCategory = category.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty || trimmedName.utf16.count > Self.maximumName { fields.insert(.name) }
        if trimmedCategory.isEmpty || trimmedCategory.utf16.count > Self.maximumCategory { fields.insert(.category) }

        var day: Int?
        var month: Int?
        switch cadence {
        case .weekly: break
        case .monthly:
            if monthlyTiming == .dayofmonth {
                day = Self.integer(dayText)
                if let value = day, (1...31).contains(value) {} else { fields.insert(.timing) }
            }
        case .yearly:
            month = Self.integer(monthText)
            day = Self.integer(dayText)
            if let month, (1...12).contains(month), let day {
                let longest = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
                if !(1...longest).contains(day) { fields.insert(.timing) }
            } else {
                fields.insert(.timing)
            }
        }
        let before = Self.integer(beforeText)
        let after = Self.integer(afterText)
        if before == nil || after == nil { fields.insert(.timing) }

        var expected: Money?, minimum: Money?, maximum: Money?
        switch amountMode {
        case .fixed:
            expected = AmountInput.parse(expectedText, language: language, deviceLocale: deviceLocale)
            if expected == nil { fields.insert(.amount) }
        case .range:
            minimum = AmountInput.parse(minimumText, language: language, deviceLocale: deviceLocale)
            maximum = AmountInput.parse(maximumText, language: language, deviceLocale: deviceLocale)
            if let minimum, let maximum { if maximum.cents < minimum.cents { fields.insert(.amount) } }
            else { fields.insert(.amount) }
        }
        if observedUnsafe { fields.insert(.amount) }
        guard fields.isEmpty, let before, let after else { return .failure(Failure(fields: fields)) }

        let timingKind = switch cadence {
        case .weekly: "weekday"
        case .yearly: "monthandday"
        case .monthly: monthlyTiming.rawValue
        }
        return .success(Values(body: CommitmentRequestBody.Confirm(
            name: trimmedName, category: trimmedCategory, cadence: cadence.rawValue, timingKind: timingKind,
            dayOfWeek: cadence == .weekly ? weekday : nil, day: showsDay ? day : nil,
            month: cadence == .yearly ? month : nil, windowBeforeDays: before, windowAfterDays: after,
            amountMode: amountMode.rawValue, expectedAmount: expected, minimumAmount: minimum, maximumAmount: maximum)))
    }
}
