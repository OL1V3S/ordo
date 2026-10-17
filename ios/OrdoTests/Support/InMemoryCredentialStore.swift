import Foundation
@testable import Ordo

final class InMemoryCredentialStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?
    private var written: [String] = []
    private var failSaves = false

    init(initial: String? = nil) { stored = initial }

    var value: String? { lock.lock(); defer { lock.unlock() }; return stored }
    var writes: [String] { lock.lock(); defer { lock.unlock() }; return written }
    func setFailSaves(_ fail: Bool) { lock.lock(); failSaves = fail; lock.unlock() }

    func read() throws -> String? { value }
    func save(_ refreshToken: String) throws {
        lock.lock(); defer { lock.unlock() }
        if failSaves { throw KeychainError.unexpectedStatus(-25299) }
        stored = refreshToken
        written.append(refreshToken)
    }
    func delete() throws { lock.lock(); stored = nil; lock.unlock() }
}
