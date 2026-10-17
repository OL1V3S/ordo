import Foundation
@testable import Ordo

final class InMemoryPendingSaveStore: PendingSaveStore, @unchecked Sendable {
    struct Failure: Error {}
    private let lock = NSLock()
    private var stored: PendingSaveLoad
    private var failSaves = false
    private var failClears = false
    private var saveCount = 0
    private var clearCount = 0

    init(_ initial: PendingSaveLoad = .none) { stored = initial }

    var current: PendingSaveLoad { lock.lock(); defer { lock.unlock() }; return stored }
    var saves: Int { lock.lock(); defer { lock.unlock() }; return saveCount }
    var clears: Int { lock.lock(); defer { lock.unlock() }; return clearCount }
    func setFailSaves(_ fail: Bool) { lock.lock(); failSaves = fail; lock.unlock() }
    func setFailClears(_ fail: Bool) { lock.lock(); failClears = fail; lock.unlock() }

    func load() -> PendingSaveLoad { current }
    func save(_ record: PendingSave) throws {
        lock.lock(); defer { lock.unlock() }
        if failSaves { throw Failure() }
        stored = .record(record)
        saveCount += 1
    }
    func clear() throws {
        lock.lock(); defer { lock.unlock() }
        if failClears { throw Failure() }
        stored = .none
        clearCount += 1
    }
}

/// Scripted sender: records every save it is given and returns or throws the next scripted result.
final class ScriptedCaptureService: CaptureService, @unchecked Sendable {
    typealias Step = @Sendable (PendingSave) async throws -> CreateResult
    private let lock = NSLock()
    private var steps: [Step]
    private var received: [PendingSave] = []
    private let onSend: @Sendable (PendingSave) -> Void

    init(_ steps: [Step], onSend: @escaping @Sendable (PendingSave) -> Void = { _ in }) {
        self.steps = steps
        self.onSend = onSend
    }

    var sent: [PendingSave] { lock.lock(); defer { lock.unlock() }; return received }

    func submit(_ save: PendingSave) async throws -> CreateResult {
        let step: Step = {
            lock.lock(); defer { lock.unlock() }
            received.append(save)
            return steps.count > 1 ? steps.removeFirst() : steps[0]
        }()
        onSend(save)
        return try await step(save)
    }
}

enum CaptureFixtures {
    static let english = Locale(identifier: "en_US")
    static let fixedNow = Date(timeIntervalSince1970: 1_792_000_000) // 2026-10-14 in UTC
    static let utc = TimeZone(secondsFromGMT: 0)!

    static func save(kind: CaptureKind = .expense, key: String = "11111111-2222-4333-8444-555555555555",
                     amount: String = "12.50", description: String = "Synthetic lunch",
                     date: String = "2026-10-17", category: String? = nil) -> PendingSave {
        PendingSave(schemaVersion: PendingSave.currentSchemaVersion, kind: kind, key: key, amount: amount,
                    descriptionText: description, date: date,
                    category: kind == .expense ? (category ?? "food") : nil,
                    createdAt: Date(timeIntervalSince1970: 1_792_000_000))
    }
}
