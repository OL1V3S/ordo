import Foundation
import Testing
@testable import Ordo

@MainActor private func makeModel(_ service: ScriptedTransactionsService,
                                  delay: Duration = .milliseconds(20)) -> TransactionsViewModel {
    TransactionsViewModel(service: service, searchDelay: delay,
                          now: { TimelineFixtures.fixedNow }, timeZone: { TimelineFixtures.utc })
}

private let firstPage: ScriptedTransactionsService.Load = { _ in
    TimelineFixtures.page(TimelineFixtures.items(26...50), hasMore: true, cursor: "cursor-A")
}

@MainActor @Suite struct TransactionsViewModelTests {
    private func loaded(_ model: TransactionsViewModel) -> TransactionsViewModel.Loaded? {
        if case .loaded(let value) = model.phase { return value }
        return nil
    }

    // MARK: Reading

    @Test func theFirstLoadReadsTheFirstPageWithoutACursor() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        #expect(model.phase == .loading)
        await model.loadIfNeeded()
        #expect(loaded(model)?.items.count == 25)
        #expect(loaded(model)?.hasMore == true && loaded(model)?.nextCursor == "cursor-A")
        #expect(service.loads == [TimelineQuery(limit: 25, cursor: nil, filter: TimelineFilter())])
    }

    @Test func theFirstLoadHappensOnlyOnce() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadIfNeeded()
        #expect(service.loads.count == 1)
    }

    @Test func loadMoreAppendsWithTheCursorAndEndsTheList() async {
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in TimelineFixtures.page(TimelineFixtures.items(1...25)) },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(loaded(model)?.items.count == 50)
        #expect(loaded(model)?.items.first?.recordId == 50 && loaded(model)?.items.last?.recordId == 1)
        #expect(loaded(model)?.hasMore == false && loaded(model)?.nextCursor == nil)
        #expect(service.loads[1].cursor == "cursor-A")
        // At the end there is nothing more to ask for.
        await model.loadMore()
        #expect(service.loads.count == 2)
    }

    @Test func loadMoreDropsRowsItAlreadyHas() async {
        let service = ScriptedTransactionsService(loads: [
            { _ in TimelineFixtures.page(TimelineFixtures.items(3...5), hasMore: true) },
            { _ in TimelineFixtures.page(TimelineFixtures.items(1...3)) }, // 3 repeats
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(loaded(model)?.items.map(\.recordId) == [5, 4, 3, 2, 1])
    }

    @Test func aRecordIdOfAnotherKindIsNotADuplicate() async {
        let service = ScriptedTransactionsService(loads: [
            { _ in TimelineFixtures.page([TimelineFixtures.item(.expense, id: 3)], hasMore: true) },
            { _ in TimelineFixtures.page([TimelineFixtures.item(.accountInflow, id: 3)]) },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(loaded(model)?.items.count == 2)
    }

    @Test func loadMoreNeedsHasMoreAndNoReadInFlight() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [{ _ in
            await gate.wait()
            return TimelineFixtures.page(TimelineFixtures.items(1...3), hasMore: true)
        }])
        let model = makeModel(service)
        let loading = Task { await model.loadIfNeeded() }
        #expect(await waitUntil { service.loads.count == 1 })
        await model.loadMore() // still loading: nothing to continue
        #expect(service.loads.count == 1)
        await gate.release()
        await loading.value
        let moreGate = Gate()
        service.setLoads([{ _ in
            await moreGate.wait()
            return TimelineFixtures.page(TimelineFixtures.items(1...2))
        }])
        let more = Task { await model.loadMore() }
        #expect(await waitUntil { await MainActor.run { model.isLoadingMore } })
        #expect(await waitUntil { service.loads.count == 2 })
        await model.loadMore() // one load more at a time
        #expect(service.loads.count == 2)
        await moreGate.release()
        await more.value
    }

    // MARK: Filters

    @Test func aFilterChangeDropsTheResultInFlightAndNeverReusesTheOldCursor() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in
                await gate.wait()
                return TimelineFixtures.page(TimelineFixtures.items(1...2), hasMore: true, cursor: "cursor-OLD")
            },
            { _ in TimelineFixtures.page([TimelineFixtures.item(.accountInflow, id: 77)]) },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        let more = Task { await model.loadMore() } // blocked at the gate, under the old filter
        #expect(await waitUntil { service.loads.count == 2 })
        model.setKind(.accountInflow)
        await model.settled()
        #expect(loaded(model)?.items.map(\.recordId) == [77])
        #expect(service.loads[2].cursor == nil)
        #expect(service.loads[2].filter.kind == .accountInflow)
        await gate.release()
        await more.value
        #expect(loaded(model)?.items.map(\.recordId) == [77]) // the old result was dropped
        #expect(loaded(model)?.filter.kind == .accountInflow)
        #expect(!model.isLoadingMore)
    }

    @Test func aSlowerEarlierReadCannotOverwriteALaterOne() async {
        let slow = Gate()
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in await slow.wait(); return TimelineFixtures.page([TimelineFixtures.item(id: 1)]) },
            { _ in TimelineFixtures.page([TimelineFixtures.item(id: 2)]) },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setKind(.expense) // read 2, held
        #expect(await waitUntil { service.loads.count == 2 })
        model.setKind(.accountInflow) // read 3 wins
        await model.settled()
        await slow.release()
        try? await Task.sleep(for: .milliseconds(30))
        #expect(loaded(model)?.items.map(\.recordId) == [2])
    }

    @Test func aFilterChangeShowsTheLoadingStateInsteadOfOldRows() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in await gate.wait(); return TimelineFixtures.page([]) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setKind(.expense)
        #expect(model.phase == .loading)
        await gate.release()
        await model.settled()
        #expect(loaded(model)?.items.isEmpty == true)
    }

    @Test func searchAppliesAfterTheDebounceWithTheTrimmedText() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setSearchText("  lunch ")
        #expect(service.loads.count == 1) // nothing yet
        #expect(await waitUntil { service.loads.count == 2 })
        await model.settled()
        #expect(service.loads[1].filter.q == "lunch")
        #expect(loaded(model)?.filter.q == "lunch")
    }

    @Test func anInvalidDraftMakesNoRequest() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setSearchText(String(repeating: "x", count: 101))
        model.setFrom(CalendarDate("2026-10-18"))
        model.setTo(CalendarDate("2026-10-17"))
        try? await Task.sleep(for: .milliseconds(80))
        #expect(service.loads.count == 1)
        #expect(model.filterProblem != nil)
        #expect(loaded(model)?.filter == TimelineFilter())
    }

    @Test func clearingFiltersResetsDraftAndAppliedAndReadsAgain() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setKind(.expense)
        model.setPeriod(.last7)
        await model.settled()
        model.clearFilters()
        await model.settled()
        #expect(model.draft == TimelineFilter() && model.applied == TimelineFilter() && model.period == .all)
        #expect(service.loads.last?.filter == TimelineFilter())
    }

    // MARK: Refresh

    @Test func pullToRefreshResetsPagingToTheFirstPage() async {
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in TimelineFixtures.page(TimelineFixtures.items(1...25)) },
            { _ in TimelineFixtures.page(TimelineFixtures.items(26...30), hasMore: true, cursor: "cursor-B") },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(loaded(model)?.items.count == 50)
        await model.refresh()
        #expect(loaded(model)?.items.count == 5)
        #expect(loaded(model)?.nextCursor == "cursor-B")
        #expect(service.loads[2].cursor == nil)
    }

    @Test func rowsStayVisibleWhileRefreshing() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in await gate.wait(); return TimelineFixtures.page([]) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        let refreshing = Task { await model.refresh() }
        #expect(await waitUntil { await MainActor.run { model.isRefreshing } })
        #expect(loaded(model)?.items.count == 25)
        await gate.release()
        await refreshing.value
        #expect(!model.isRefreshing)
    }

    @Test func aFailedPullToRefreshKeepsTheRowsWithAWarning() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw APIError.offline }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.refresh()
        #expect(loaded(model)?.items.count == 25)
        #expect(model.refreshFailed)
        service.setLoads([firstPage])
        await model.refresh()
        #expect(!model.refreshFailed)
    }

    @Test func aFailedRefreshAfterAKnownChangeClearsTheRows() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw APIError.server(500) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        let fresh = await model.refresh(afterChange: true)
        #expect(!fresh)
        #expect(model.phase == .failed(.generic))
        #expect(model.items.isEmpty)
    }

    @Test func aPullToRefreshCannotRestoreStaleRowsWhileAChangeRefreshIsPending() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in await gate.wait(); throw APIError.server(500) }, // the refresh after a change
            { _ in throw APIError.offline }, // a pull to refresh that supersedes it
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        let afterChange = Task { await model.refresh(afterChange: true) }
        #expect(await waitUntil { service.loads.count == 2 })
        await model.refresh()
        await gate.release()
        await afterChange.value
        #expect(model.items.isEmpty) // strict until a read succeeds
        #expect(model.phase == .failed(.offline))
    }

    @Test func refreshIfLoadedDoesNothingBeforeTheListWasOpened() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.refreshIfLoaded()
        #expect(service.loads.isEmpty)
        await model.loadIfNeeded()
        await model.refreshIfLoaded()
        #expect(service.loads.count == 2)
    }

    // MARK: Failures

    @Test func loadMoreFailureKeepsTheRowsAndCanBeRetried() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw APIError.offline }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(model.loadMoreFailed && !model.isLoadingMore)
        #expect(loaded(model)?.items.count == 25)
        service.setLoads([{ _ in TimelineFixtures.page(TimelineFixtures.items(1...5)) }])
        await model.loadMore()
        #expect(!model.loadMoreFailed && loaded(model)?.items.count == 30)
        #expect(service.loads.last?.cursor == "cursor-A")
    }

    @Test func aRejectedCursorRestartsFromTheFirstPageAndNeverLoops() async {
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in throw APIError.timelineRejected(.cursor) },
            { _ in TimelineFixtures.page(TimelineFixtures.items(26...30), hasMore: true, cursor: "cursor-FRESH") },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        await model.settled()
        #expect(service.loads.count == 3)
        #expect(service.loads[2].cursor == nil)
        #expect(loaded(model)?.nextCursor == "cursor-FRESH" && loaded(model)?.items.count == 5)
        #expect(!model.loadMoreFailed)
    }

    @Test func aRejectedCursorWhoseRestartAlsoFailsDoesNotLoop() async {
        let service = ScriptedTransactionsService(loads: [
            firstPage,
            { _ in throw APIError.timelineRejected(.cursor) },
            { _ in throw APIError.timelineRejected(.cursor) },
        ])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        await model.settled()
        try? await Task.sleep(for: .milliseconds(30))
        #expect(service.loads.count == 3)
        #expect(model.refreshFailed)
    }

    @Test func aRejectedLimitIsALoadMoreFailure() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw APIError.timelineRejected(.limit) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(model.loadMoreFailed && service.loads.count == 2)
    }

    @Test(arguments: [
        (APIError.offline, TransactionsViewModel.Failure.offline),
        (APIError.timelineUnavailable, .unavailable),
        (APIError.server(500), .generic),
        (APIError.invalidResponse, .generic),
        (APIError.timelineRejected(.cursor), .generic),
        (APIError.timelineRejected(.limit), .generic),
        (APIError.timelineRejected(.search), .filterRejected),
        (APIError.timelineRejected(.kind), .filterRejected),
        (APIError.timelineRejected(.date), .filterRejected),
    ])
    func eachFirstReadFailureMapsToTheAppsOwnState(error: APIError, expected: TransactionsViewModel.Failure) async {
        let service = ScriptedTransactionsService(loads: [{ _ in throw error }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        #expect(model.phase == .failed(expected))
    }

    @Test func aMalformedPageHidesAllRows() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw TimelineReadError.malformed }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.refresh()
        #expect(model.phase == .malformed)
        #expect(model.items.isEmpty)
    }

    @Test func aMalformedLoadMorePageHidesAllRows() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw TimelineReadError.malformed }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        await model.loadMore()
        #expect(model.phase == .malformed)
    }

    @Test func aServerFilterRejectionShowsTheAppsOwnMessageAndNoRows() async {
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in throw APIError.timelineRejected(.search) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setKind(.expense)
        await model.settled()
        #expect(model.phase == .failed(.filterRejected))
        #expect(TransactionsPresenter.failureKey(.filterRejected) == .timelineFiltersInvalid)
    }

    @Test func aSessionEndKeepsTheStateQuiet() async {
        let service = ScriptedTransactionsService(loads: [{ _ in throw SessionError.signedOut }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        #expect(model.phase == .loading)
    }

    // MARK: Session

    @Test func resetDropsRowsFiltersAndAReadInFlight() async {
        let gate = Gate()
        let service = ScriptedTransactionsService(loads: [firstPage, { _ in await gate.wait(); return TimelineFixtures.page([]) }])
        let model = makeModel(service)
        await model.loadIfNeeded()
        model.setKind(.expense)
        #expect(await waitUntil { service.loads.count == 2 })
        model.reset()
        #expect(model.phase == .loading && model.items.isEmpty)
        #expect(model.draft == TimelineFilter() && model.applied == TimelineFilter())
        await gate.release()
        try? await Task.sleep(for: .milliseconds(30))
        #expect(model.phase == .loading) // the late result was dropped
        service.setLoads([firstPage])
        await model.loadIfNeeded() // reads again after a reset
        #expect(loaded(model)?.items.count == 25)
    }

    @Test func aPageDoesNotPrintItsRows() async {
        let service = ScriptedTransactionsService(loads: [firstPage])
        let model = makeModel(service)
        await model.loadIfNeeded()
        let query = TimelineQuery(cursor: "secret-cursor", filter: TimelineFilter(q: "secret search"))
        for text in [String(describing: query), String(reflecting: query), String(describing: query.filter)] {
            #expect(!text.contains("secret"))
        }
    }
}
