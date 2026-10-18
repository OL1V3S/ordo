import Foundation
@testable import Ordo

/// Scripted service: records every read and every write it is given and returns or throws the next
/// scripted result. Reads and writes never touch the network.
final class ScriptedTransactionsService: TransactionsService, @unchecked Sendable {
    typealias Load = @Sendable (TimelineQuery) async throws -> TimelinePage
    typealias Perform = @Sendable (MutationRequest) async throws -> MutationResult

    private let lock = NSLock()
    private var loadSteps: [Load]
    private var performSteps: [Perform]
    private var loadsReceived: [TimelineQuery] = []
    private var performsReceived: [MutationRequest] = []

    init(loads: [Load] = [{ _ in TimelineFixtures.page([]) }], performs: [Perform] = [{ _ in .applied }]) {
        loadSteps = loads
        performSteps = performs
    }

    var loads: [TimelineQuery] { lock.lock(); defer { lock.unlock() }; return loadsReceived }
    var performs: [MutationRequest] { lock.lock(); defer { lock.unlock() }; return performsReceived }

    func setLoads(_ steps: [Load]) { lock.lock(); loadSteps = steps; lock.unlock() }
    func setPerforms(_ steps: [Perform]) { lock.lock(); performSteps = steps; lock.unlock() }

    func loadTimeline(_ query: TimelineQuery) async throws -> TimelinePage {
        let step: Load = {
            lock.lock(); defer { lock.unlock() }
            loadsReceived.append(query)
            return loadSteps.count > 1 ? loadSteps.removeFirst() : loadSteps[0]
        }()
        return try await step(query)
    }

    func perform(_ request: MutationRequest) async throws -> MutationResult {
        let step: Perform = {
            lock.lock(); defer { lock.unlock() }
            performsReceived.append(request)
            return performSteps.count > 1 ? performSteps.removeFirst() : performSteps[0]
        }()
        return try await step(request)
    }
}

enum TimelineFixtures {
    static let english = Locale(identifier: "en_US")
    /// 2026-10-17 12:00 UTC.
    static let fixedNow = Date(timeIntervalSince1970: 1_792_238_400)
    static let utc = TimeZone(secondsFromGMT: 0)!

    static func item(_ kind: TimelineItem.Kind = .expense, id: Int = 1, date: String = "2026-10-17",
                     amount: TimelineAmount = .exact(Money.parse("12.50")!), description: String = "Synthetic lunch",
                     category: String? = nil, linked: Bool = false) -> TimelineItem {
        TimelineItem(kind: kind, recordId: id, date: CalendarDate(date)!, amount: amount, descriptionText: description,
                     category: kind == .expense ? (category ?? "food") : nil, paycheckLinked: linked)
    }

    static func page(_ items: [TimelineItem], hasMore: Bool = false, cursor: String? = nil, limit: Int = 25) -> TimelinePage {
        TimelinePage(items: items, limit: limit, hasMore: hasMore, nextCursor: hasMore ? (cursor ?? "cursor-1") : nil)
    }

    /// Items `first...last` as expenses, newest first.
    static func items(_ range: ClosedRange<Int>) -> [TimelineItem] {
        range.reversed().map { item(id: $0, description: "Synthetic row \($0)") }
    }
}

/// A reference cell for values that an async stub needs to share with a test.
final class Cell<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value
    init(_ value: Value) { stored = value }
    var value: Value {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}
