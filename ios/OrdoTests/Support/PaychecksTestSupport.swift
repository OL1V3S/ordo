import Foundation
@testable import Ordo

enum PaycheckFixtures {
    static let id1 = "11111111-1111-4111-8111-111111111111"
    static let id2 = "22222222-2222-4222-8222-222222222222"

    static func date(_ text: String) -> CalendarDate { CalendarDate(text)! }

    static func slot(_ relation: PaycheckSlot.Relation = .current, anchor: String = "2026-10-16",
                     from: String = "2026-10-15", to: String = "2026-10-18") -> PaycheckSlot {
        PaycheckSlot(relation: relation, anchor: date(anchor), earliest: date(from), latest: date(to))
    }

    static func evidence(_ id: Int, kind: PaycheckEvidence.Kind = .recordedReceipt) -> PaycheckEvidence {
        PaycheckEvidence(accountInflowId: id, postedDate: date("2026-10-02"), amount: .exact(Money.parse("10.00")!),
                         text: "Synthetic", source: .manual, slotAnchor: date("2026-10-02"), timingOffsetDays: 0,
                         edited: false, kind: kind)
    }

    static func profile(_ id: String = id1, name: String = "Synthetic Employer", lifecycle: PaycheckLifecycle = .active,
                        amount: PaycheckAmount = .fixed(.exact(Money.parse("1200.25")!)),
                        evidence: [PaycheckEvidence] = [], slots: [PaycheckSlot]? = nil) -> PaycheckProfile {
        PaycheckProfile(id: id, name: name, lifecycle: lifecycle, schedule: nil, windowBeforeDays: 1, windowAfterDays: 2,
                        amount: amount, isManual: true, evidence: evidence,
                        slots: slots ?? (lifecycle == .active ? [slot(.current), slot(.previous, anchor: "2026-10-02", from: "2026-10-01", to: "2026-10-04")] : []),
                        projection: nil)
    }

    static func snapshot(_ profiles: [PaycheckProfile] = [profile()]) -> PaychecksSnapshot {
        PaychecksSnapshot(evaluatedOn: date("2026-10-20"), profiles: profiles)
    }

    static func deposit(_ id: Int, _ text: String = "Synthetic deposit", amount: String = "10.00", date: String = "2026-10-05") -> SavedDeposit {
        SavedDeposit(id: id, text: text, amount: Money.parse(amount).map(PaycheckMoney.exact) ?? .needsReview,
                     date: CalendarDate(date))
    }

    @MainActor
    static func model(_ service: ScriptedPaychecksService, refreshOthers: @escaping @MainActor () async -> Void = {},
                      other: @escaping @MainActor () -> Bool = { false }) -> PaychecksViewModel {
        PaychecksViewModel(service: service, refreshOthers: refreshOthers, isOtherWriteInFlight: other, language: .en,
                           deviceLocale: TimelineFixtures.english, now: { TimelineFixtures.fixedNow }, timeZone: TimelineFixtures.utc)
    }

    @MainActor
    static func loaded(_ service: ScriptedPaychecksService, refreshOthers: @escaping @MainActor () async -> Void = {},
                       other: @escaping @MainActor () -> Bool = { false }) async -> PaychecksViewModel {
        let model = model(service, refreshOthers: refreshOthers, other: other)
        await model.refresh()
        return model
    }
}

/// Scripted service: records every read and write and returns or throws the next scripted result.
final class ScriptedPaychecksService: PaychecksService, @unchecked Sendable {
    typealias Load = @Sendable () async throws -> PaychecksSnapshot
    typealias Deposits = @Sendable () async throws -> [SavedDeposit]
    typealias Perform = @Sendable (PaycheckWrite) async throws -> Void

    private let lock = NSLock()
    private var loadSteps: [Load]
    private var depositSteps: [Deposits]
    private var performSteps: [Perform]
    private var loads = 0
    private var depositReads = 0
    private var performed: [PaycheckWrite] = []

    init(loads: [Load] = [{ PaycheckFixtures.snapshot() }],
         deposits: [Deposits] = [{ [] }],
         performs: [Perform] = [{ _ in }]) {
        loadSteps = loads
        depositSteps = deposits
        performSteps = performs
    }

    var loadCount: Int { lock.lock(); defer { lock.unlock() }; return loads }
    var depositCount: Int { lock.lock(); defer { lock.unlock() }; return depositReads }
    var writes: [PaycheckWrite] { lock.lock(); defer { lock.unlock() }; return performed }

    func setLoads(_ steps: [Load]) { lock.lock(); loadSteps = steps; lock.unlock() }
    func setPerforms(_ steps: [Perform]) { lock.lock(); performSteps = steps; lock.unlock() }

    func loadPaychecks() async throws -> PaychecksSnapshot {
        let step: Load = {
            lock.lock(); defer { lock.unlock() }
            loads += 1
            return loadSteps.count > 1 ? loadSteps.removeFirst() : loadSteps[0]
        }()
        return try await step()
    }

    func loadDeposits() async throws -> [SavedDeposit] {
        let step: Deposits = {
            lock.lock(); defer { lock.unlock() }
            depositReads += 1
            return depositSteps.count > 1 ? depositSteps.removeFirst() : depositSteps[0]
        }()
        return try await step()
    }

    func perform(_ write: PaycheckWrite) async throws {
        let step: Perform = {
            lock.lock(); defer { lock.unlock() }
            performed.append(write)
            return performSteps.count > 1 ? performSteps.removeFirst() : performSteps[0]
        }()
        try await step(write)
    }
}
