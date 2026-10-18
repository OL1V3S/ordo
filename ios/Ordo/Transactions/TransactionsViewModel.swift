import Foundation
import Observation
import os

/// The Transactions list: server cursor paging, search and filters. A port of the web's
/// `useActivityTimeline` and `useTimelineFilters`.
///
/// Every read is guarded by a read token that `reset()`, a filter change and every new first read
/// advance, so a result from an older filter, an older read or an older session is dropped. Rows,
/// cursor and `hasMore` are only ever continued under the filter they were read with. Nothing here
/// is persisted and no row is ever changed locally: a change is always followed by a re-read.
@MainActor @Observable
final class TransactionsViewModel {
    enum Failure: Equatable {
        case offline
        case unavailable
        case generic
        /// The server refused the search, kind or dates. The app shows its own filter message.
        case filterRejected
    }

    struct Loaded: Equatable {
        var items: [TimelineItem]
        var hasMore: Bool
        var nextCursor: String?
        /// The filter these rows were read under (not the draft in the controls).
        var filter: TimelineFilter
    }

    enum Phase: Equatable {
        case loading
        case loaded(Loaded)
        case failed(Failure)
        /// The page failed validation, so no row is shown.
        case malformed
    }

    private(set) var phase: Phase = .loading
    /// A re-read is running and the rows stay visible.
    private(set) var isRefreshing = false
    /// A re-read failed and the rows from the earlier read are kept, with a warning.
    private(set) var refreshFailed = false
    private(set) var isLoadingMore = false
    private(set) var loadMoreFailed = false

    /// What the controls show. An invalid draft is never applied.
    private(set) var draft = TimelineFilter()
    private(set) var period: TimelinePeriod = .all
    /// What the timeline is read with.
    private(set) var applied = TimelineFilter()

    var filterProblem: TimelineFilterProblem? { TimelineFilterRules.validate(draft) }
    var isFilterActive: Bool { TimelineFilterRules.isActive(draft) || TimelineFilterRules.isActive(applied) }

    var items: [TimelineItem] {
        if case .loaded(let loaded) = phase { return loaded.items }
        return []
    }

    var today: CalendarDate { DateFormatting.localCalendarDate(now: now(), timeZone: timeZone()) }

    @ObservationIgnored private let service: TransactionsService
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let timeZone: @Sendable () -> TimeZone
    @ObservationIgnored private let searchDelay: Duration
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "transactions")
    /// Advanced by `reset()`, a filter change and every new first read. A result that started under
    /// an older value is dropped.
    @ObservationIgnored private var readToken = 0
    /// True once the first read has been asked for (the Transactions tab was opened).
    @ObservationIgnored private var started = false
    /// Set by a re-read that follows a known change, until a read finishes: a failure then clears
    /// the rows instead of keeping money from before the change.
    @ObservationIgnored private var strictRefresh = false
    @ObservationIgnored private var firstReadTask: Task<Void, Never>?
    @ObservationIgnored private var moreTask: Task<Void, Never>?
    @ObservationIgnored private var debounceTask: Task<Void, Never>?

    init(service: TransactionsService,
         searchDelay: Duration = TimelineFilterRules.searchDebounce,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: @escaping @Sendable () -> TimeZone = { TimeZone.current }) {
        self.service = service
        self.searchDelay = searchDelay
        self.now = now
        self.timeZone = timeZone
    }

    // MARK: Session

    /// Drops everything (sign-out, session end, sign-in): rows, filters, cursors and any read in
    /// flight.
    func reset() {
        readToken += 1
        firstReadTask?.cancel()
        moreTask?.cancel()
        debounceTask?.cancel()
        firstReadTask = nil
        moreTask = nil
        debounceTask = nil
        started = false
        strictRefresh = false
        phase = .loading
        isRefreshing = false
        refreshFailed = false
        isLoadingMore = false
        loadMoreFailed = false
        draft = TimelineFilter()
        applied = TimelineFilter()
        period = .all
    }

    // MARK: Reading

    /// The first read, when the tab first appears after sign-in.
    func loadIfNeeded() async {
        guard !started else { return }
        started = true
        await startFirstRead(clearRows: true).value
    }

    /// "Try again": shows the loading state.
    func load() async {
        started = true
        await startFirstRead(clearRows: true).value
    }

    /// Re-reads the first page under the applied filter. The rows stay visible while it runs. After
    /// a known change (`afterChange`), a failure clears them instead of keeping money from before
    /// the change. Returns true only when the read this call started is the one that completed and
    /// the rows loaded from it; false when a newer read replaced it or the read failed.
    @discardableResult
    func refresh(afterChange: Bool = false) async -> Bool {
        started = true
        let task = startFirstRead(clearRows: false, strict: afterChange)
        let token = readToken
        await task.value
        guard token == readToken, firstReadTask == nil else { return false }
        if case .loaded = phase { return !refreshFailed }
        return false
    }

    /// For a change made elsewhere (a saved expense or deposit): only once the list has been opened.
    func refreshIfLoaded() async {
        guard started else { return }
        await refresh(afterChange: true)
    }

    /// Waits for the reads in flight. For tests.
    func settled() async {
        await firstReadTask?.value
        await moreTask?.value
        await firstReadTask?.value
    }

    @discardableResult
    private func startFirstRead(clearRows: Bool, strict: Bool = false) -> Task<Void, Never> {
        readToken += 1
        let token = readToken
        if strict { strictRefresh = true }
        moreTask = nil
        isLoadingMore = false
        loadMoreFailed = false
        refreshFailed = false
        let filter = applied
        if clearRows {
            phase = .loading
            isRefreshing = false
        } else if case .loaded = phase {
            isRefreshing = true
        } else {
            phase = .loading
            isRefreshing = false
        }
        let query = TimelineQuery(cursor: nil, filter: filter)
        let service = self.service
        let task = Task { @MainActor [weak self] in
            let outcome = await Self.read { try await service.loadTimeline(query) }
            self?.finishFirstRead(outcome, token: token, filter: filter)
        }
        firstReadTask = task
        return task
    }

    private func finishFirstRead(_ outcome: ReadOutcome, token: Int, filter: TimelineFilter) {
        guard token == readToken else { return }
        firstReadTask = nil
        isRefreshing = false
        let strict = strictRefresh
        strictRefresh = false
        switch outcome {
        case .page(let page):
            refreshFailed = false
            phase = .loaded(Loaded(items: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor, filter: filter))
        case .malformed:
            logger.error("Timeline page failed validation")
            phase = .malformed
        case .sessionEnded:
            // The app returns to sign-in; keep the state quiet.
            phase = .loading
        case .failed(let failure):
            logger.error("Timeline read failed")
            if failure.isFilterRejection {
                phase = .failed(.filterRejected)
            } else if case .loaded = phase, !strict {
                refreshFailed = true
            } else {
                phase = .failed(failure.failure)
            }
        }
    }

    /// Shows the next page under the filter the rows were read with. Needs `hasMore`, a cursor and
    /// no read in flight.
    func loadMore() async {
        guard case .loaded(let loaded) = phase, loaded.hasMore, let cursor = loaded.nextCursor,
              firstReadTask == nil, !isLoadingMore else { return }
        let token = readToken
        isLoadingMore = true
        loadMoreFailed = false
        let query = TimelineQuery(cursor: cursor, filter: loaded.filter)
        let service = self.service
        let task = Task { @MainActor [weak self] in
            let outcome = await Self.read { try await service.loadTimeline(query) }
            self?.finishLoadMore(outcome, token: token)
        }
        moreTask = task
        await task.value
    }

    private func finishLoadMore(_ outcome: ReadOutcome, token: Int) {
        guard token == readToken, case .loaded(var loaded) = phase else { return }
        moreTask = nil
        isLoadingMore = false
        switch outcome {
        case .page(let page):
            // A record edited elsewhere between two page reads could repeat; never show it twice.
            let seen = Set(loaded.items.map(\.id))
            loaded.items += page.items.filter { !seen.contains($0.id) }
            loaded.hasMore = page.hasMore
            loaded.nextCursor = page.nextCursor
            phase = .loaded(loaded)
        case .malformed:
            logger.error("Timeline page failed validation")
            phase = .malformed
        case .sessionEnded:
            phase = .loading
        case .failed(let failure):
            logger.error("Timeline load more failed")
            if case .rejected(.cursor) = failure {
                // A cursor the server no longer accepts is never retried: start again from the
                // first page under the same filter.
                startFirstRead(clearRows: false)
            } else {
                loadMoreFailed = true
            }
        }
    }

    // MARK: Read outcomes

    enum ReadFailure: Equatable {
        case offline
        case unavailable
        case rejected(TimelineRejection)
        case generic

        var isFilterRejection: Bool {
            if case .rejected(let rejection) = self { return rejection.isFilter }
            return false
        }

        var failure: Failure {
            switch self {
            case .offline: .offline
            case .unavailable: .unavailable
            case .rejected(let rejection): rejection.isFilter ? .filterRejected : .generic
            case .generic: .generic
            }
        }
    }

    enum ReadOutcome: Equatable {
        case page(TimelinePage)
        case malformed
        case failed(ReadFailure)
        case sessionEnded
    }

    nonisolated static func read(_ operation: @Sendable () async throws -> TimelinePage) async -> ReadOutcome {
        do {
            return .page(try await operation())
        } catch is TimelineReadError {
            return .malformed
        } catch let error as APIError {
            switch error {
            case .offline: return .failed(.offline)
            case .timelineUnavailable: return .failed(.unavailable)
            case .timelineRejected(let rejection): return .failed(.rejected(rejection))
            case .sessionEnded: return .sessionEnded
            default: return .failed(.generic)
            }
        } catch SessionError.signedOut {
            return .sessionEnded
        } catch {
            return .failed(.generic)
        }
    }

    // MARK: Filters

    func setSearchText(_ text: String) {
        draft.q = text
        draftChanged()
    }

    func setKind(_ kind: TimelineKindFilter) {
        draft.kind = kind
        draftChanged()
    }

    func setPeriod(_ newPeriod: TimelinePeriod) {
        period = newPeriod
        if let range = TimelineFilterRules.range(for: newPeriod, today: today) {
            draft.from = range.from
            draft.to = range.to
        }
        draftChanged()
    }

    func setFrom(_ date: CalendarDate?) {
        period = .custom
        draft.from = date
        draftChanged()
    }

    func setTo(_ date: CalendarDate?) {
        period = .custom
        draft.to = date
        draftChanged()
    }

    func clearFilters() {
        debounceTask?.cancel()
        debounceTask = nil
        draft = TimelineFilter()
        period = .all
        let changed = applied != TimelineFilter()
        applied = TimelineFilter()
        if changed || phase == .failed(.filterRejected), started { startFirstRead(clearRows: true) }
    }

    /// Applies the draft when it is valid and different from what is applied. Search alone is
    /// debounced; kind and dates apply at once. An invalid draft never replaces the applied filter.
    private func draftChanged() {
        debounceTask?.cancel()
        debounceTask = nil
        guard TimelineFilterRules.validate(draft) == nil else { return }
        let next = TimelineFilterRules.normalize(draft)
        guard next != applied else { return }
        if TimelineFilterRules.isSearchOnlyChange(from: applied, to: next) {
            let delay = searchDelay
            debounceTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled, let self else { return }
                self.debounceTask = nil
                self.apply(next)
            }
        } else {
            apply(next)
        }
    }

    private func apply(_ next: TimelineFilter) {
        guard next != applied else { return }
        applied = next
        if started { startFirstRead(clearRows: true) }
    }
}
