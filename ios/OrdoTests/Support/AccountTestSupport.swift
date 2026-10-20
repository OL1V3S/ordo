import Foundation
@testable import Ordo

/// Scripted account service: records each call and runs the next scripted step. No network.
final class ScriptedAccountService: AccountService, @unchecked Sendable {
    typealias Step = @Sendable () async throws -> Void
    enum Call: Equatable { case register(String, String, AppLanguage), resend(String, AppLanguage), forgot(String, AppLanguage) }

    private let lock = NSLock()
    private var steps: [Step]
    private var received: [Call] = []

    init(_ steps: [Step] = [{}]) { self.steps = steps }

    var calls: [Call] { lock.lock(); defer { lock.unlock() }; return received }
    func setSteps(_ steps: [Step]) { lock.lock(); self.steps = steps; lock.unlock() }

    private func run(_ call: Call) async throws {
        let step: Step = {
            lock.lock(); defer { lock.unlock() }
            received.append(call)
            return steps.count > 1 ? steps.removeFirst() : steps[0]
        }()
        try await step()
    }

    func register(email: String, password: String, language: AppLanguage) async throws {
        try await run(.register(email, password, language))
    }
    func resendConfirmation(email: String, language: AppLanguage) async throws { try await run(.resend(email, language)) }
    func forgotPassword(email: String, language: AppLanguage) async throws { try await run(.forgot(email, language)) }
}
