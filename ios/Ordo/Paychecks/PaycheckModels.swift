import Foundation

enum PaycheckLifecycle: String, Sendable, CaseIterable {
    case active, paused, ended
}

/// An amount read from the server. Anything that is not an exact positive amount inside the range
/// is "needs review"; it is never guessed, rounded or totalled.
enum PaycheckMoney: Equatable, Sendable {
    case exact(Money)
    case needsReview

    var money: Money? {
        if case .exact(let value) = self { return value }
        return nil
    }
}

enum PaycheckAmount: Equatable, Sendable {
    case fixed(PaycheckMoney)
    case range(minimum: PaycheckMoney, maximum: PaycheckMoney)
    case unavailable
}

enum PaycheckCadence: String, Sendable {
    case weekly, biweekly, semimonthly, monthly, unknown
}

enum MonthAnchor: Equatable, Sendable {
    case day(Int)
    case monthEnd
    case unknown
}

struct PaycheckSchedule: Equatable, Sendable {
    let cadence: PaycheckCadence
    let reference: CalendarDate?
    let first: MonthAnchor?
    let second: MonthAnchor?
}

struct PaycheckProjection: Equatable, Sendable {
    let earliest: CalendarDate?
    let latest: CalendarDate?
    let anchor: CalendarDate?
    let amount: PaycheckAmount
}

/// One server-allowed slot for linking a received paycheck. The app never computes slots.
struct PaycheckSlot: Equatable, Hashable, Sendable {
    enum Relation: String, Sendable { case current, previous }
    let relation: Relation
    let anchor: CalendarDate
    let earliest: CalendarDate
    let latest: CalendarDate
}

struct PaycheckEvidence: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Source: Equatable, Sendable { case imported, manual, unknown }
    enum Kind: Equatable, Sendable { case recordedReceipt, confirmationEvidence }

    let accountInflowId: Int
    let postedDate: CalendarDate?
    let amount: PaycheckMoney
    let text: String
    let source: Source
    let slotAnchor: CalendarDate?
    let timingOffsetDays: Int?
    let edited: Bool
    let kind: Kind

    var id: Int { accountInflowId }
    var description: String { "PaycheckEvidence(redacted)" }
    var isRemovable: Bool { kind == .recordedReceipt }
    var debugDescription: String { description }
}

struct PaycheckProfile: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: String
    let name: String
    let lifecycle: PaycheckLifecycle
    let schedule: PaycheckSchedule?
    let windowBeforeDays: Int?
    let windowAfterDays: Int?
    let amount: PaycheckAmount
    let isManual: Bool
    let evidence: [PaycheckEvidence]
    let slots: [PaycheckSlot]
    let projection: PaycheckProjection?

    var description: String { "PaycheckProfile(redacted)" }
    var debugDescription: String { description }
    var canLinkDeposit: Bool { lifecycle == .active && !slots.isEmpty }
}

struct PaychecksSnapshot: Equatable, Sendable {
    let evaluatedOn: CalendarDate?
    let profiles: [PaycheckProfile]

    /// Every inflow linked to any schedule (all lifecycles, all evidence kinds) in this read.
    var claimedInflowIds: Set<Int> {
        Set(profiles.flatMap { $0.evidence.map(\.accountInflowId) })
    }
}

struct SavedDeposit: Equatable, Identifiable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: Int
    let text: String
    let amount: PaycheckMoney
    let date: CalendarDate?

    var description: String { "SavedDeposit(redacted)" }
    var debugDescription: String { description }
}

/// One write, frozen at the first valid tap. Immutable, so a retry sends the same bytes.
struct PaycheckWrite: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    enum Operation: Equatable, Sendable {
        case lifecycle(id: String, value: PaycheckLifecycle, body: Data)
        case record(id: String, body: Data)
        case removeReceipt(id: String, inflowId: Int)
    }

    let operation: Operation
    var description: String { "PaycheckWrite(redacted)" }
    var debugDescription: String { description }
}

enum PaychecksReadError: Error, Equatable, Sendable { case malformed }
