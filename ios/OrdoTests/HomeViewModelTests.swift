import Foundation
import Testing
@testable import Ordo

/// Scripted Home service: the first call waits on a gate, later calls return immediately.
private final class GatedHomeService: HomeService, @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    let gate = Gate()
    let first: HomeSnapshot
    let later: HomeSnapshot

    init(first: HomeSnapshot, later: HomeSnapshot) { self.first = first; self.later = later }

    var callCount: Int { lock.lock(); defer { lock.unlock() }; return calls }

    func loadHome(activityThroughDate: CalendarDate) async throws -> HomeSnapshot {
        let call: Int = { lock.lock(); defer { lock.unlock() }; calls += 1; return calls }()
        if call == 1 {
            await gate.wait()
            return first
        }
        return later
    }
}

@MainActor @Suite struct HomeViewModelTests {
    @Test func aStaleLoadAfterResetNeitherOverwritesNorBlocksTheNewSession() async throws {
        let old = try Fixtures.snapshot("home-all-available")
        let new = try Fixtures.snapshot("home-available-empty")
        #expect(old != new)
        let service = GatedHomeService(first: old, later: new)
        let model = HomeViewModel(service: service)

        let slow = Task { await model.load() }
        #expect(await waitUntil { service.callCount == 1 })

        model.reset()
        await model.load() // the new session's load is not dropped
        #expect(service.callCount == 2)
        #expect(model.phase == .loaded(new))

        await service.gate.release()
        await slow.value
        #expect(model.phase == .loaded(new)) // the old result is discarded
        #expect(!model.isRefreshing)

        await model.refresh() // in-flight state is not left stuck
        #expect(service.callCount == 3)
        #expect(model.phase == .loaded(new))
    }
}
