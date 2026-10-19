import Foundation
@testable import Ordo

/// Scripted service: records every read and every write it is given and returns or throws the next
/// scripted result. Nothing touches the network.
final class ScriptedBudgetsService: BudgetsService, @unchecked Sendable {
    typealias LoadLimits = @Sendable (BudgetMonth) async throws -> [BudgetLimitRow]
    typealias LoadPage = @Sendable (TimelineQuery) async throws -> TimelinePage
    typealias Perform = @Sendable (BudgetWrite) async throws -> MutationResult

    private let lock = NSLock()
    private var limitSteps: [LoadLimits]
    private var pageSteps: [LoadPage]
    private var performSteps: [Perform]
    private var limitsReceived: [BudgetMonth] = []
    private var pagesReceived: [TimelineQuery] = []
    private var performsReceived: [BudgetWrite] = []

    init(limits: [LoadLimits] = [{ _ in BudgetFixtures.defaultRows }],
         pages: [LoadPage] = [{ _ in TimelineFixtures.page([], limit: 100) }],
         performs: [Perform] = [{ _ in .applied }]) {
        limitSteps = limits
        pageSteps = pages
        performSteps = performs
    }

    var limitReads: [BudgetMonth] { lock.lock(); defer { lock.unlock() }; return limitsReceived }
    var pageReads: [TimelineQuery] { lock.lock(); defer { lock.unlock() }; return pagesReceived }
    var writes: [BudgetWrite] { lock.lock(); defer { lock.unlock() }; return performsReceived }

    func setLimits(_ steps: [LoadLimits]) { lock.lock(); limitSteps = steps; lock.unlock() }
    func setPages(_ steps: [LoadPage]) { lock.lock(); pageSteps = steps; lock.unlock() }
    func setPerforms(_ steps: [Perform]) { lock.lock(); performSteps = steps; lock.unlock() }

    func loadLimits(month: BudgetMonth) async throws -> [BudgetLimitRow] {
        let step: LoadLimits = {
            lock.lock(); defer { lock.unlock() }
            limitsReceived.append(month)
            return limitSteps.count > 1 ? limitSteps.removeFirst() : limitSteps[0]
        }()
        return try await step(month)
    }

    func loadTimelinePage(_ query: TimelineQuery) async throws -> TimelinePage {
        let step: LoadPage = {
            lock.lock(); defer { lock.unlock() }
            pagesReceived.append(query)
            return pageSteps.count > 1 ? pageSteps.removeFirst() : pageSteps[0]
        }()
        return try await step(query)
    }

    func perform(_ write: BudgetWrite) async throws -> MutationResult {
        let step: Perform = {
            lock.lock(); defer { lock.unlock() }
            performsReceived.append(write)
            return performSteps.count > 1 ? performSteps.removeFirst() : performSteps[0]
        }()
        return try await step(write)
    }
}

enum BudgetFixtures {
    static let october = BudgetMonth(year: 2026, month: 10)!

    /// Food 200.00 and Transport 50.50.
    static let defaultRows: [BudgetLimitRow] = [
        row(id: 11, category: "food", limit: "200.00"),
        row(id: 12, category: "transport", limit: "50.50"),
    ]

    /// A limit of nil is a limit that needs review.
    static func row(id: Int, category: String, limit: String?) -> BudgetLimitRow {
        BudgetLimitRow(id: id, category: category, limit: limit.flatMap { Money.parse($0, allowZero: true) }.map(BudgetLimitValue.exact) ?? .needsReview)
    }

    static func expense(id: Int, date: String = "2026-10-09", amount: String = "10.00", category: String = "food") -> TimelineItem {
        let money = Money.parse(amount)
        return TimelineFixtures.item(.expense, id: id, date: date,
                                     amount: money.map(TimelineAmount.exact) ?? .needsReview(amount), category: category)
    }

    static func page(_ items: [TimelineItem], cursor: String? = nil) -> TimelinePage {
        TimelineFixtures.page(items, hasMore: cursor != nil, cursor: cursor, limit: 100)
    }

    @MainActor
    static func model(_ service: ScriptedBudgetsService, refreshHome: @escaping @MainActor () async -> Void = {},
                      now: @escaping @Sendable () -> Date = { TimelineFixtures.fixedNow },
                      deviceLocale: Locale = TimelineFixtures.english) -> BudgetsViewModel {
        BudgetsViewModel(service: service, refreshHome: refreshHome, language: .en, deviceLocale: deviceLocale,
                         now: now, timeZone: { TimelineFixtures.utc })
    }
}
