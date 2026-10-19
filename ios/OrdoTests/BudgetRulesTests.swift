import Foundation
import Testing
@testable import Ordo

private func limit(_ cents: Int64) -> BudgetLimitValue { .exact(Money.fromCents(cents)!) }

private func eval(used: Int64, limit cents: Int64, spendingAvailable: Bool = true) -> BudgetEvaluation {
    BudgetRules.evaluate(spendingAvailable: spendingAvailable, used: .cents(used), limit: limit(cents))
}

@Suite struct BudgetRulesTests {
    // MARK: The eight statuses, in the web's order

    @Test func spendingUnavailableComesFirst() {
        let result = BudgetRules.evaluate(spendingAvailable: false, used: .needsReview, limit: .needsReview)
        #expect(result.status == .spendingUnavailable)
        #expect(result.usedCents == nil && !result.comparisonAvailable && !result.showsComparisonUnavailable)
        // Whatever total is passed while spending is unavailable, "used" is never shown.
        #expect(eval(used: 500, limit: 1000, spendingAvailable: false).usedCents == nil)
        #expect(eval(used: 500, limit: 1000, spendingAvailable: false).status == .spendingUnavailable)
    }

    @Test func anUnreadableTotalIsSpendingNeedsReviewEvenWithAnUnreadableLimit() {
        let result = BudgetRules.evaluate(spendingAvailable: true, used: .needsReview, limit: .needsReview)
        #expect(result.status == .spendingNeedsReview)
        #expect(result.showsComparisonUnavailable && !result.comparisonAvailable)
        #expect(result.percentTenths == nil && !result.warning)
    }

    @Test func anUnreadableLimitIsLimitNeedsReview() {
        let result = BudgetRules.evaluate(spendingAvailable: true, used: .cents(500), limit: .needsReview)
        #expect(result.status == .limitNeedsReview)
        #expect(result.showsComparisonUnavailable && result.usedCents == 500 && result.limitCents == nil)
    }

    @Test func aZeroLimitIsZeroLimitWithNoSpendingAndWithSpending() {
        for used: Int64 in [0, 1, 5000] {
            let result = eval(used: used, limit: 0)
            #expect(result.status == .zeroLimit)
            #expect(result.showsZeroLimitNote && result.percentTenths == nil && result.barTenths == nil)
            #expect(result.warning)
        }
    }

    @Test func overReachedNearAndWithin() {
        #expect(eval(used: 10_001, limit: 10_000).status == .overLimit)
        #expect(eval(used: 10_000, limit: 10_000).status == .limitReached)
        #expect(eval(used: 9_000, limit: 10_000).status == .nearLimit)
        #expect(eval(used: 8_999, limit: 10_000).status == .withinLimit)
        #expect(eval(used: 0, limit: 10_000).status == .withinLimit)
    }

    @Test func everyStatusIsReachable() {
        let statuses: Set<BudgetStatusTag> = [
            tag(BudgetRules.evaluate(spendingAvailable: false, used: .cents(0), limit: limit(1))),
            tag(BudgetRules.evaluate(spendingAvailable: true, used: .needsReview, limit: limit(1))),
            tag(BudgetRules.evaluate(spendingAvailable: true, used: .cents(0), limit: .needsReview)),
            tag(eval(used: 0, limit: 0)), tag(eval(used: 2, limit: 1)), tag(eval(used: 1, limit: 1)),
            tag(eval(used: 9, limit: 10)), tag(eval(used: 1, limit: 10)),
        ].reduce(into: Set()) { $0.insert($1) }
        #expect(statuses.count == BudgetStatus.allCases.count)
    }

    // MARK: Boundaries at 90%, 100% and beyond

    @Test(arguments: [
        // (used cents, limit cents, status, whole percent)
        (Int64(8_999), Int64(10_000), BudgetStatus.withinLimit, Int128(90)),    // 89.99%: label rounds to 90, status exact
        (9_000, 10_000, .nearLimit, 90),                                         // exactly 90.00%
        (9_001, 10_000, .nearLimit, 90),
        (9_999, 10_000, .nearLimit, 100),                                        // 99.99%
        (10_000, 10_000, .limitReached, 100),
        (10_001, 10_000, .overLimit, 100),                                       // 100.01%
        (15_000, 10_000, .overLimit, 150),
        (100_000, 10_000, .overLimit, 1_000),
        (1, 10_000, .withinLimit, 0),
    ])
    func theBoundaries(used: Int64, limitCents: Int64, status: BudgetStatus, whole: Int128) {
        let result = eval(used: used, limit: limitCents)
        #expect(result.status == status)
        #expect(result.percentWhole == whole)
    }

    @Test func eightyNinePointNineFivePercentLabelsNinetyButIsStillWithinLimit() {
        let result = eval(used: 8_995, limit: 10_000)
        #expect(result.percentTenths == 900)
        #expect(result.percentWhole == 90)
        #expect(result.status == .withinLimit && !result.warning)
    }

    @Test(arguments: [
        // (used, limit, tenths, whole): half up in tenths and in whole percent
        (Int64(1), Int64(3), Int128(333), Int128(33)),
        (2, 3, 667, 67),
        (1, 8, 125, 13),     // 12.5% -> 13%
        (1, 200, 5, 1),      // 0.5% -> 1%
        (1, 400, 3, 0),      // 0.25% -> 0.3 -> 0%
        (7, 10, 700, 70),
        (0, 5, 0, 0),
    ])
    func percentRoundsHalfUp(used: Int64, limitCents: Int64, tenths: Int128, whole: Int128) {
        let result = eval(used: used, limit: limitCents)
        #expect(result.percentTenths == tenths)
        #expect(result.percentWhole == whole)
    }

    @Test func theBarIsCappedAtOneHundredPercentButThePercentIsNot() {
        let result = eval(used: 15_000, limit: 10_000)
        #expect(result.barTenths == 1000)
        #expect(result.percentWhole == 150)
        #expect(eval(used: 5_000, limit: 10_000).barTenths == 500)
        #expect(eval(used: 0, limit: 10_000).barTenths == 0)
        #expect(eval(used: Money.maximumCents, limit: 1).barTenths == 1000)
    }

    @Test func maximumAmountsNeverTrapAndStayExact() {
        let largest = Money.maximumCents
        // used * 1000 and used * 100 overflow Int64: Int128 carries both the percent and the 90% check.
        let over = eval(used: largest, limit: 1)
        #expect(over.status == .overLimit && over.warning)
        #expect(over.percentTenths == Int128(largest) * 1000)
        #expect(over.percentWhole == Int128(largest) * 100)
        let equal = eval(used: largest, limit: largest)
        #expect(equal.status == .limitReached && equal.percentTenths == 1000)
        let near = eval(used: largest / 10 * 9, limit: largest / 10 * 10)
        #expect(near.status == .nearLimit)
        let under = eval(used: largest / 10 * 9 - 1, limit: largest / 10 * 10)
        #expect(under.status == .withinLimit)
        #expect(BudgetRules.isAtOrAboveNinetyPercent(used: largest, limit: 1))
        #expect(BudgetRules.percentTenths(used: 5, limit: 0) == nil)
    }

    @Test func theNearLimitStateIsAWarningAndAtOrAboveNinetyPercentIsToo() {
        #expect(!eval(used: 8_999, limit: 10_000).warning)
        #expect(eval(used: 9_000, limit: 10_000).warning)
        #expect(eval(used: 10_000, limit: 10_000).warning)
        #expect(eval(used: 12_000, limit: 10_000).warning)
        #expect(eval(used: 0, limit: 0).warning)
    }

    @Test func aPositiveLimitWithAnExactComparisonShowsABarAndNoNote() {
        let result = eval(used: 5_000, limit: 10_000)
        #expect(result.comparisonAvailable && result.barTenths == 500)
        #expect(!result.showsZeroLimitNote && !result.showsComparisonUnavailable)
    }

    // MARK: Duplicates

    @Test func theLastRowPerExactCategoryWinsInOrderOfFirstAppearanceAndNothingIsMerged() {
        let rows = [
            BudgetFixtures.row(id: 1, category: "Food", limit: "100.00"),
            BudgetFixtures.row(id: 2, category: "food", limit: "50.00"),
            BudgetFixtures.row(id: 3, category: "Food", limit: "200.00"),
            BudgetFixtures.row(id: 4, category: " food", limit: "5.00"),
        ]
        let shown = BudgetRules.shownRows(rows)
        #expect(shown.map(\.id) == [3, 2, 4])
        #expect(shown[0].limit == .exact(Money.parse("200.00")!)) // the last row's limit, never a sum
        #expect(rows.count == 4) // the input is untouched
    }

    @Test func aPrecomposedAndADecomposedCategoryAreTwoRows() {
        let rows = [
            BudgetFixtures.row(id: 1, category: "caf\u{e9}", limit: "1.00"),
            BudgetFixtures.row(id: 2, category: "cafe\u{301}", limit: "2.00"),
        ]
        #expect(BudgetRules.shownRows(rows).map(\.id) == [1, 2])
    }

    @Test func noRowsGiveNoCards() {
        #expect(BudgetRules.shownRows([]).isEmpty)
    }

    @Test func rowsAreRedactedWhenPrinted() {
        let row = BudgetFixtures.row(id: 1, category: "synthetic-category", limit: "9.99")
        #expect("\(row)" == "BudgetLimitRow(redacted)" && String(reflecting: row) == "BudgetLimitRow(redacted)")
    }
}

private typealias BudgetStatusTag = Int

private func tag(_ evaluation: BudgetEvaluation) -> BudgetStatusTag {
    BudgetStatus.allCases.firstIndex(of: evaluation.status)!
}
