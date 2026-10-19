import Foundation
import Testing
@testable import Ordo

private let october = BudgetMonth(year: 2026, month: 10)!
private let today = CalendarDate("2026-10-17")!

private func expense(_ id: Int, _ amount: String = "10.00", category: String = "food", date: String = "2026-10-09") -> TimelineItem {
    BudgetFixtures.expense(id: id, date: date, amount: amount, category: category)
}

/// Records the queries and serves scripted pages by call number.
private final class PageScript: @unchecked Sendable {
    private let lock = NSLock()
    private var received: [TimelineQuery] = []
    private let pages: @Sendable (Int, TimelineQuery) async throws -> TimelinePage
    init(_ pages: @escaping @Sendable (Int, TimelineQuery) async throws -> TimelinePage) { self.pages = pages }
    var queries: [TimelineQuery] { lock.lock(); defer { lock.unlock() }; return received }
    func load(_ query: TimelineQuery) async throws -> TimelinePage {
        let number: Int = { lock.lock(); defer { lock.unlock() }; received.append(query); return received.count }()
        return try await pages(number, query)
    }
}

private func read(_ script: PageScript, month: BudgetMonth = october, today: CalendarDate = today) async throws -> BudgetSpending {
    try await BudgetSpendingReader.read(month: month, today: today) { try await script.load($0) }
}

private func total(_ spending: BudgetSpending, _ category: String) -> BudgetSpending.Total { spending.total(for: category) }

@Suite struct BudgetSpendingTests {
    // MARK: Paging

    @Test func pagesAreSummedToTheEndWithTheCursorAndRepeatedRecordsCountOnce() async throws {
        let script = PageScript { number, _ in
            switch number {
            case 1: BudgetFixtures.page([expense(1, "10.00"), expense(2, "5.50"), expense(3, "3.00", category: "transport")], cursor: "c1")
            default: BudgetFixtures.page([expense(3, "3.00", category: "transport"), expense(4, "1.00")])
            }
        }
        let spending = try await read(script)
        #expect(total(spending, "food") == .cents(1650))
        #expect(total(spending, "transport") == .cents(300))
        #expect(total(spending, "bills") == .cents(0))
        let queries = script.queries
        #expect(queries.count == 2)
        #expect(queries[0].cursor == nil && queries[1].cursor == "c1")
        for query in queries {
            #expect(query.limit == 100)
            #expect(query.filter.kind == .expense)
            #expect(query.filter.from?.isoString == "2026-10-01")
            #expect(query.filter.to?.isoString == "2026-10-17")
            #expect(query.filter.q.isEmpty)
        }
    }

    @Test func aFailureOnTheSecondPageMakesTheWholeMonthUnavailableWithNoPartialSum() async {
        let script = PageScript { number, _ in
            if number == 1 { return BudgetFixtures.page([expense(1, "10.00")], cursor: "c1") }
            throw APIError.offline
        }
        await #expect(throws: APIError.offline) { try await read(script) }
        #expect(script.queries.count == 2)
    }

    @Test(arguments: [APIError.timelineUnavailable, .server(500), .timelineRejected(.cursor), .timelineRejected(.date), .invalidResponse])
    func everyPageFailureThrows(error: APIError) async {
        let script = PageScript { _, _ in throw error }
        await #expect(throws: error) { try await read(script) }
    }

    @Test func aRepeatedCursorStopsTheReadAsRunaway() async {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1)], cursor: "same") }
        await #expect(throws: BudgetSpendingError.runaway) { try await read(script) }
        #expect(script.queries.count == 2) // first with no cursor, second with "same", then "same" repeats
    }

    @Test func moreThanOneHundredPagesStopsTheReadAsRunaway() async {
        let script = PageScript { number, _ in BudgetFixtures.page([expense(number)], cursor: "cursor-\(number)") }
        await #expect(throws: BudgetSpendingError.runaway) { try await read(script) }
        #expect(script.queries.count == BudgetSpendingReader.maximumPages)
    }

    @Test func exactlyOneHundredPagesIsStillRead() async throws {
        let script = PageScript { number, _ in
            BudgetFixtures.page([expense(number, "1.00")], cursor: number < 100 ? "cursor-\(number)" : nil)
        }
        let spending = try await read(script)
        #expect(total(spending, "food") == .cents(10_000))
    }

    // MARK: Malformed

    @Test func aDepositOnAPageMakesTheReadMalformed() async {
        let deposit = TimelineFixtures.item(.accountInflow, id: 9, date: "2026-10-09")
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1), deposit]) }
        await #expect(throws: BudgetSpendingError.malformed) { try await read(script) }
    }

    @Test(arguments: ["2026-09-30", "2026-10-18", "2026-11-01", "2025-10-09"])
    func anItemOutsideTheRequestedDatesMakesTheReadMalformed(date: String) async {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1), expense(2, date: date)]) }
        await #expect(throws: BudgetSpendingError.malformed) { try await read(script) }
    }

    @Test func aTimelineAmountThatIsNotTwoDecimalsMakesTheWholePageMalformed() {
        let json = #"{"currencyCode":"USD","items":[{"kind":"expense","recordId":1,"date":"2026-10-09","amount":"1.5","description":"x","category":"food","paycheck":null}],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
        #expect(throws: TimelineValidation.ParseError.malformed) { try TimelineValidation.parse(Data(json.utf8)) }
    }

    // MARK: Cutoff

    @Test func theCurrentMonthCountsThroughTodayOnly() async throws {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, date: "2026-10-01"), expense(2, date: "2026-10-17")]) }
        _ = try await read(script, today: CalendarDate("2026-10-17")!)
        #expect(script.queries[0].filter.from?.isoString == "2026-10-01")
        #expect(script.queries[0].filter.to?.isoString == "2026-10-17")
    }

    @Test func theFirstOfTheMonthIsTheWholeCutoffOnTheFirst() async throws {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, date: "2026-10-01")]) }
        _ = try await read(script, today: CalendarDate("2026-10-01")!)
        #expect(script.queries[0].filter.to?.isoString == "2026-10-01")
    }

    @Test func aPastMonthIsTheWholeMonth() async throws {
        let february = BudgetMonth(year: 2028, month: 2)!
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, date: "2028-02-29")]) }
        let spending = try await read(script, month: february, today: CalendarDate("2028-10-17")!)
        #expect(script.queries[0].filter.from?.isoString == "2028-02-01")
        #expect(script.queries[0].filter.to?.isoString == "2028-02-29")
        #expect(total(spending, "food") == .cents(1000))
    }

    @Test func aFutureMonthSendsNoRequestAndEveryRowShowsZero() async throws {
        let script = PageScript { _, _ in throw APIError.offline }
        let spending = try await read(script, month: BudgetMonth(year: 2026, month: 11)!)
        #expect(script.queries.isEmpty)
        #expect(spending == .empty)
        #expect(total(spending, "food") == .cents(0))
        #expect(BudgetSpendingReader.range(for: BudgetMonth(year: 2027, month: 1)!, today: today) == nil)
    }

    // MARK: Matching

    @Test func categoriesMatchByTheExactStringNoTrimNoCaseFoldNoAlias() async throws {
        let script = PageScript { _, _ in
            BudgetFixtures.page([expense(1, "1.00", category: "Food"), expense(2, "2.00", category: "food"),
                                 expense(3, "4.00", category: " food "), expense(4, "8.00", category: "FOOD")])
        }
        let spending = try await read(script)
        #expect(total(spending, "Food") == .cents(100))
        #expect(total(spending, "food") == .cents(200))
        #expect(total(spending, " food ") == .cents(400))
        #expect(total(spending, "FOOD") == .cents(800))
        #expect(total(spending, "foo") == .cents(0))
    }

    @Test func aPrecomposedAndADecomposedAccentAreDifferentCategories() async throws {
        let precomposed = "caf\u{e9}"
        let decomposed = "cafe\u{301}"
        #expect(precomposed == decomposed) // Swift String equality would merge them...
        let script = PageScript { _, _ in
            BudgetFixtures.page([expense(1, "1.00", category: precomposed), expense(2, "2.00", category: decomposed)])
        }
        let spending = try await read(script)
        #expect(total(spending, precomposed) == .cents(100)) // ...the server and the web do not
        #expect(total(spending, decomposed) == .cents(200))
        #expect(ExactCategoryKey(precomposed) != ExactCategoryKey(decomposed))
    }

    // MARK: Amounts

    @Test(arguments: ["0.00", "-5.00"])
    func anUnreadableAmountMakesOnlyThatCategoryNeedReviewAndItStaysSo(amount: String) async throws {
        let script = PageScript { _, _ in
            BudgetFixtures.page([expense(1, "5.00"), expense(2, amount), expense(3, "7.00"),
                                 expense(4, "3.00", category: "transport")])
        }
        let spending = try await read(script)
        #expect(total(spending, "food") == .needsReview)
        #expect(total(spending, "transport") == .cents(300))
        #expect(!spending.hasBlankCategoryExpense)
    }

    @Test func aTotalAboveTheMaximumNeedsReview() async throws {
        let largest = "9999999999999999.99"
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, largest), expense(2, "0.01")]) }
        #expect(total(try await read(script), "food") == .needsReview)
        let exact = PageScript { _, _ in BudgetFixtures.page([expense(1, largest)]) }
        #expect(total(try await read(exact), "food") == .cents(Money.maximumCents))
        let two = PageScript { _, _ in BudgetFixtures.page([expense(1, largest, category: "a"), expense(2, largest, category: "b")]) }
        let spending = try await read(two)
        #expect(total(spending, "a") == .cents(Money.maximumCents) && total(spending, "b") == .cents(Money.maximumCents))
    }

    // MARK: Blank categories (owner decision: option a)

    @Test(arguments: ["", "   ", "\t", "\u{a0}", "\u{2003}"])
    func anExpenseWithABlankCategoryMakesEverySpendingTotalUnavailableForTheMonth(blank: String) async throws {
        let script = PageScript { _, _ in
            BudgetFixtures.page([expense(1, "5.00"), expense(2, "9.00", category: blank), expense(3, "3.00", category: "transport")])
        }
        let spending = try await read(script)
        #expect(spending.hasBlankCategoryExpense)
        for category in ["food", "transport", "bills", "Uncategorized", "uncategorized", blank] {
            #expect(total(spending, category) == .needsReview)
        }
    }

    @Test func aBlankCategoryIsNeverAliasedToUncategorized() async throws {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, "9.00", category: "")]) }
        let spending = try await read(script)
        #expect(spending.totals.isEmpty)
        #expect(spending.hasBlankCategoryExpense)
    }

    @Test func aLimitRowWithABlankCategoryNeverShowsSpending() {
        let none = BudgetSpending.empty
        #expect(none.total(for: "") == .needsReview)
        #expect(none.total(for: "  ") == .needsReview)
        #expect(none.total(for: "food") == .cents(0))
    }

    @Test func theFixturePageIsReadAndSummed() async throws {
        let page = try TimelineValidation.parse(try Fixtures.data("timeline-expense-month-october"))
        let script = PageScript { _, _ in page }
        let spending = try await read(script)
        #expect(total(spending, "food") == .cents(2000))
        #expect(total(spending, "transport") == .cents(300))
    }

    @Test func redactedDescriptionsHideTheTotals() async throws {
        let script = PageScript { _, _ in BudgetFixtures.page([expense(1, "5.00")]) }
        let spending = try await read(script)
        #expect("\(spending)" == "BudgetSpending(redacted)" && String(reflecting: spending) == "BudgetSpending(redacted)")
    }
}
