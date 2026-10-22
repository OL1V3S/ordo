import Foundation
@testable import Ordo

enum RecurringFixtures {
    static let fp1 = String(repeating: "a", count: 64)
    static let fp2 = String(repeating: "b", count: 64)
    static let id1 = "11111111-1111-4111-8111-111111111111"
    static let id2 = "22222222-2222-4222-8222-222222222222"

    static func money(_ text: String) -> CommitmentMoney { Money.parse(text).map(CommitmentMoney.exact) ?? .needsReview }

    static func timing(_ cadence: String = "monthly", kind: String = "dayofmonth", weekday: String? = nil,
                       day: Int? = 15, month: Int? = nil, before: Int = 1, after: Int = 2) -> CommitmentTiming {
        CommitmentTiming(cadence: cadence, kind: kind, dayOfWeek: weekday, day: day, month: month,
                         windowBeforeDays: before, windowAfterDays: after)
    }

    static func evidence(_ id: Int = 1) -> CommitmentEvidence {
        CommitmentEvidence(expenseId: id, date: CalendarDate("2026-09-15"), amount: money("12.34"), text: "Synthetic",
                           category: "bills", source: "manual")
    }

    static func candidate(_ fingerprint: String = fp1, name: String = "Synthetic Streaming", fixed: Bool = true,
                          median: String = "12.34", timing: CommitmentTiming = timing()) -> RecurringCandidate {
        RecurringCandidate(fingerprint: fingerprint, name: name, category: "bills", timing: timing, observedFixed: fixed,
                           median: money(median), minimum: money(fixed ? median : "10.00"), maximum: money(fixed ? median : "14.50"),
                           coveredFrom: CalendarDate("2026-07-15"), coveredTo: CalendarDate("2026-09-15"), occurrenceCount: 3,
                           evidenceRule: "consecutive_calendar_months", evidence: [evidence(1), evidence(2)])
    }

    static func commitment(_ id: String = id1, name: String = "Synthetic Rent", lifecycle: CommitmentLifecycle = .active,
                           amount: CommitmentAmount = .fixed(.exact(Money.parse("1200.25")!))) -> RecurringCommitment {
        RecurringCommitment(id: id, name: name, category: "bills", lifecycle: lifecycle, timing: timing(), amount: amount,
                            evidence: [evidence()])
    }

    static func snapshot(candidates: [RecurringCandidate] = [candidate()], dismissed: [RecurringCandidate] = [],
                         commitments: [RecurringCommitment] = [commitment()]) -> RecurringSnapshot {
        RecurringSnapshot(candidates: candidates, dismissed: dismissed, commitments: commitments)
    }

    @MainActor
    static func model(_ service: ScriptedRecurringService, refreshOthers: @escaping @MainActor () async -> Void = {},
                      other: @escaping @MainActor () -> Bool = { false }) -> RecurringViewModel {
        RecurringViewModel(service: service, refreshOthers: refreshOthers, isOtherWriteInFlight: other, language: .en,
                           deviceLocale: TimelineFixtures.english)
    }

    @MainActor
    static func loaded(_ service: ScriptedRecurringService, refreshOthers: @escaping @MainActor () async -> Void = {},
                       other: @escaping @MainActor () -> Bool = { false }) async -> RecurringViewModel {
        let model = model(service, refreshOthers: refreshOthers, other: other)
        await model.refresh()
        return model
    }
}

/// Scripted service: records every read and write and returns or throws the next scripted result.
final class ScriptedRecurringService: RecurringService, @unchecked Sendable {
    typealias Load = @Sendable () async throws -> RecurringSnapshot
    typealias LoadChanges = @Sendable () async throws -> CommitmentChangesSnapshot
    typealias Perform = @Sendable (CommitmentWrite) async throws -> Void

    private let lock = NSLock()
    private var loadSteps: [Load]
    private var performSteps: [Perform]
    private var changeSteps: [LoadChanges]
    private var changeLoads = 0
    private var loads = 0
    private var performed: [CommitmentWrite] = []

    init(loads: [Load] = [{ RecurringFixtures.snapshot() }], performs: [Perform] = [{ _ in }],
         changes: [LoadChanges] = [{ CommitmentChangesSnapshot(evaluatedOn: CalendarDate("2026-10-01"), changes: []) }]) {
        changeSteps = changes
        loadSteps = loads
        performSteps = performs
    }

    var loadCount: Int { lock.lock(); defer { lock.unlock() }; return loads }
    var writes: [CommitmentWrite] { lock.lock(); defer { lock.unlock() }; return performed }

    var changeLoadCount: Int { lock.lock(); defer { lock.unlock() }; return changeLoads }
    func setChanges(_ steps: [LoadChanges]) { lock.lock(); changeSteps = steps; lock.unlock() }
    func setLoads(_ steps: [Load]) { lock.lock(); loadSteps = steps; lock.unlock() }
    func setPerforms(_ steps: [Perform]) { lock.lock(); performSteps = steps; lock.unlock() }

    func load() async throws -> RecurringSnapshot {
        let step: Load = {
            lock.lock(); defer { lock.unlock() }
            loads += 1
            return loadSteps.count > 1 ? loadSteps.removeFirst() : loadSteps[0]
        }()
        return try await step()
    }

    func loadChanges() async throws -> CommitmentChangesSnapshot {
        let step: LoadChanges = {
            lock.lock(); defer { lock.unlock() }
            changeLoads += 1
            return changeSteps.count > 1 ? changeSteps.removeFirst() : changeSteps[0]
        }()
        return try await step()
    }

    func perform(_ write: CommitmentWrite) async throws {
        let step: Perform = {
            lock.lock(); defer { lock.unlock() }
            performed.append(write)
            return performSteps.count > 1 ? performSteps.removeFirst() : performSteps[0]
        }()
        try await step(write)
    }
}
