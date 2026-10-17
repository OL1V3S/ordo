import Foundation
import Observation

protocol HomeService: Sendable {
    func loadHome(activityThroughDate: CalendarDate) async throws -> HomeSnapshot
}

/// Production Home loader: authorized request through the session, then strict validation.
struct SessionHomeService: HomeService {
    let session: SessionManager
    let api: OrdoAPI

    func loadHome(activityThroughDate: CalendarDate) async throws -> HomeSnapshot {
        let api = self.api
        let data = try await session.authorized { token in
            try await api.home(accessToken: token.value, activityThroughDate: activityThroughDate)
        }
        do { return try HomeValidation.parse(data) } catch { throw APIError.invalidResponse }
    }
}

@MainActor @Observable
final class HomeViewModel {
    enum Phase: Equatable {
        case loading
        case loaded(HomeSnapshot)
        case homeUnavailable
        case offline
        case failed
    }

    private(set) var phase: Phase = .loading
    private(set) var isRefreshing = false

    private let service: HomeService
    private let now: @Sendable () -> Date
    private let timeZone: @Sendable () -> TimeZone
    private var loadedFor: CalendarDate?
    /// The running load. A request that arrives while it runs waits for it and asks for one
    /// follow-up load, so a response that started before a save can never be the last word.
    private var fetchTask: Task<Void, Never>?
    private var reloadRequested = false
    /// Incremented by `reset()`; a fetch that started under an older value discards its result.
    private var generation = 0

    init(service: HomeService,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: @escaping @Sendable () -> TimeZone = { TimeZone.current }) {
        self.service = service
        self.now = now
        self.timeZone = timeZone
    }

    var activityThroughDate: CalendarDate {
        DateFormatting.localCalendarDate(now: now(), timeZone: timeZone())
    }

    /// Drops any previous content (sign-out / sign-in).
    func reset() {
        generation += 1
        fetchTask = nil
        reloadRequested = false
        phase = .loading
        loadedFor = nil
        isRefreshing = false
    }

    /// Initial load and "Try again": shows the loading state.
    func load() async {
        phase = .loading
        await fetch()
    }

    /// Pull to refresh: content stays visible while loading. A failure replaces it (no stale data).
    func refresh() async {
        let started = generation
        if case .loaded = phase { isRefreshing = true } else { phase = .loading }
        await fetch()
        if started == generation { isRefreshing = false }
    }

    /// When the app becomes active: reload only if the local date changed.
    func reloadIfDateChanged() async {
        guard let loadedFor, loadedFor != activityThroughDate else { return }
        await refresh()
    }

    private func fetch() async {
        if let fetchTask {
            reloadRequested = true
            await fetchTask.value
            return
        }
        let started = generation
        let task = Task { [weak self] in
            guard let self else { return }
            await self.runLoads(started: started)
        }
        fetchTask = task
        await task.value
    }

    /// Loads once, then again while another request arrived in the meantime.
    private func runLoads(started: Int) async {
        repeat {
            reloadRequested = false
            await loadOnce(started: started)
        } while reloadRequested && started == generation
        if started == generation { fetchTask = nil }
    }

    private func loadOnce(started: Int) async {
        let date = activityThroughDate
        do {
            let snapshot = try await service.loadHome(activityThroughDate: date)
            guard started == generation else { return }
            loadedFor = date
            phase = .loaded(snapshot)
        } catch {
            guard started == generation else { return }
            loadedFor = nil
            phase = Self.phase(for: error, current: phase)
        }
    }

    static func phase(for error: Error, current: Phase) -> Phase {
        switch error {
        case APIError.offline: .offline
        case APIError.homeUnavailable: .homeUnavailable
        // The session ended while loading: the app shows the sign-in screen; keep the state quiet.
        case SessionError.signedOut, APIError.sessionEnded: .loading
        default: .failed
        }
    }
}
