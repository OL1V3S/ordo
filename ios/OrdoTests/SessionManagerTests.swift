import Foundation
import Testing
@testable import Ordo

private let createPath = "/api/auth/device-sessions"
private let refreshPath = "/api/auth/device-sessions/refresh"
private let signOutPath = "/api/auth/device-sessions/sign-out"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

private struct Harness {
    let transport = StubTransport()
    let store: InMemoryCredentialStore
    let manager: SessionManager

    init(stored: String? = nil) {
        store = InMemoryCredentialStore(initial: stored)
        manager = SessionManager(api: OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport), store: store)
        transport.route(signOutPath) { _ in StubResponse(204, Data()) }
    }

    func signIn(access: String = "access-1", refresh: String = "refresh-1") async throws {
        transport.route(createPath) { _ in session(access, refresh) }
        try await manager.signIn(email: "person@example.test", password: "synthetic-password")
    }
}

/// An operation that fails with 401 for one access token and succeeds for any other.
private func rejecting(_ stale: String) -> @Sendable (AccessToken) async throws -> String {
    { token in
        if token.value == stale { throw APIError.unauthorized }
        return token.value
    }
}

private actor AttemptCounter {
    private var value = 0
    func next() -> Int { value += 1; return value }
}

@Suite struct SessionManagerTests {
    @Test func restoreRefreshesAndSavesBeforeExposingTheToken() async throws {
        let h = Harness(stored: "refresh-0")
        h.transport.route(refreshPath) { request in
            // The credential sent is the stored one, and nothing is stored yet.
            #expect(String(data: request.httpBody ?? Data(), encoding: .utf8)?.contains("refresh-0") == true)
            return session("access-1", "refresh-1")
        }
        await h.manager.restore()
        #expect(await h.manager.state == .signedIn)
        #expect(h.store.value == "refresh-1")
        #expect(h.store.writes.allSatisfy { !$0.hasPrefix("access") })
        let token = try await h.manager.authorized { $0.value }
        #expect(token == "access-1")
        #expect(h.transport.count(refreshPath) == 1)
    }

    @Test func restoreWhenTheRefreshFailsOfflineStaysSignedInAndRetriesLater() async throws {
        let h = Harness(stored: "refresh-0")
        let attempts = AttemptCounter()
        h.transport.route(refreshPath) { _ in
            if await attempts.next() == 1 { throw URLError(.notConnectedToInternet) }
            return session("access-1", "refresh-1")
        }
        await h.manager.restore()
        #expect(await h.manager.state == .signedIn)
        #expect(h.store.value == "refresh-0")
        #expect(h.store.writes.isEmpty)
        #expect(h.transport.count(refreshPath) == 1)
        let token = try await h.manager.authorized { $0.value }
        #expect(token == "access-1")
        #expect(h.transport.count(refreshPath) == 2)
        #expect(h.store.value == "refresh-1")
    }

    @Test func restoreWithAnInvalidSessionSignsOutAndClearsTheStore() async throws {
        let h = Harness(stored: "refresh-0")
        let invalid = try StubResponse(401, fixture: "auth-session-invalid")
        h.transport.route(refreshPath) { _ in invalid }
        await h.manager.restore()
        #expect(await h.manager.state == .signedOut(.sessionEnded))
        #expect(h.store.value == nil)
        #expect(h.transport.count(refreshPath) == 1)
    }

    @Test func restoreWithNoCredentialIsSignedOut() async {
        let h = Harness()
        await h.manager.restore()
        #expect(await h.manager.state == .signedOut(.none))
        #expect(h.transport.count(refreshPath) == 0)
    }

    @Test func signInTrimsTheEmailAndNeverStoresThePassword() async throws {
        let h = Harness()
        h.transport.route(createPath) { _ in session("access-1", "refresh-1") }
        try await h.manager.signIn(email: "  Person@Example.test \n", password: "synthetic-password")
        let body = String(data: h.transport.bodies(createPath)[0], encoding: .utf8) ?? ""
        #expect(body.contains("\"email\":\"Person@Example.test\""))
        #expect(h.store.value == "refresh-1")
        #expect(h.store.writes == ["refresh-1"])
    }

    @Test func signInFailsWhenTheCredentialCannotBeStored() async {
        let h = Harness()
        h.store.setFailSaves(true)
        h.transport.route(createPath) { _ in session("access-1", "refresh-1") }
        await #expect(throws: SessionError.storageFailed) {
            try await h.manager.signIn(email: "a@b.test", password: "x")
        }
        #expect(await h.manager.state != .signedIn)
    }

    @Test func a401LeadsToOneRefreshThenARetry() async throws {
        let h = Harness()
        try await h.signIn()
        h.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        let result = try await h.manager.authorized(rejecting("access-1"))
        #expect(result == "access-2")
        #expect(h.transport.count(refreshPath) == 1)
        #expect(h.store.value == "refresh-2")
    }

    @Test func tenConcurrentCallersCauseExactlyOneRefreshRequest() async throws {
        let h = Harness()
        try await h.signIn()
        let gate = Gate()
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return session("access-2", "refresh-2")
        }
        let barrier = Barrier(10)
        let manager = h.manager
        let tasks = (0..<10).map { _ in
            Task {
                try await manager.authorized { token in
                    if token.value == "access-1" {
                        await barrier.arrive() // all ten have a stale token before any refresh can finish
                        throw APIError.unauthorized
                    }
                    return token.value
                }
            }
        }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        await gate.release()
        for task in tasks { #expect(try await task.value == "access-2") }
        #expect(h.transport.count(refreshPath) == 1)
        #expect(h.store.value == "refresh-2")
    }

    @Test func sessionInvalidDeletesTheStoreAndFailsEveryWaitingCaller() async throws {
        let h = Harness()
        try await h.signIn()
        let gate = Gate()
        let invalid = try StubResponse(401, fixture: "auth-session-invalid")
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return invalid
        }
        let manager = h.manager
        let tasks = (0..<3).map { _ in Task { try await manager.authorized(rejecting("access-1")) } }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        await gate.release()
        for task in tasks {
            await #expect(throws: APIError.sessionEnded) { try await task.value }
        }
        #expect(h.store.value == nil)
        #expect(await h.manager.state == .signedOut(.sessionEnded))
    }

    @Test func offlineRefreshKeepsTheCredential() async throws {
        let h = Harness()
        try await h.signIn()
        h.transport.route(refreshPath) { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: APIError.offline) { try await h.manager.authorized(rejecting("access-1")) }
        #expect(h.store.value == "refresh-1")
        #expect(await h.manager.state == .signedIn)
    }

    @Test func cancellingACallerDoesNotCancelTheRefresh() async throws {
        let h = Harness()
        try await h.signIn()
        let gate = Gate()
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return session("access-2", "refresh-2")
        }
        let manager = h.manager
        let caller = Task { try await manager.authorized(rejecting("access-1")) }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        caller.cancel()
        await gate.release()
        #expect(await waitUntil { h.store.value == "refresh-2" })
        #expect(await h.manager.state == .signedIn)
    }

    @Test func aRefreshThatCompletesAfterSignOutDoesNotWriteTheCredentialBack() async throws {
        let h = Harness()
        try await h.signIn()
        let gate = Gate()
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return session("access-2", "refresh-2")
        }
        let manager = h.manager
        let caller = Task { try await manager.authorized(rejecting("access-1")) }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        await h.manager.signOut()
        await gate.release()
        await #expect(throws: SessionError.signedOut) { try await caller.value }
        #expect(h.store.value == nil)
        #expect(await h.manager.state == .signedOut(.none))
    }

    @Test func aLateOldRefreshFailureDoesNotTouchANewerSession() async throws {
        let h = Harness()
        try await h.signIn(access: "access-1", refresh: "refresh-1")
        let gate = Gate()
        let invalid = try StubResponse(401, fixture: "auth-session-invalid")
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return invalid
        }
        let manager = h.manager
        let caller = Task { try await manager.authorized(rejecting("access-1")) }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        await h.manager.signOut()
        try await h.signIn(access: "access-9", refresh: "refresh-9")
        await gate.release()
        await #expect(throws: SessionError.signedOut) { try await caller.value }
        #expect(h.store.value == "refresh-9")
        #expect(await h.manager.state == .signedIn)
        #expect(try await h.manager.authorized { $0.value } == "access-9")
    }

    @Test func aLaunchRestoreOverlappingAnAuthorizedCallSendsOneRefresh() async throws {
        let h = Harness(stored: "refresh-0")
        let gate = Gate()
        h.transport.route(refreshPath) { _ in
            await gate.wait()
            return session("access-1", "refresh-1")
        }
        let manager = h.manager
        let restoring = Task { await manager.restore() }
        #expect(await waitUntil { h.transport.count(refreshPath) == 1 })
        let caller = Task { try await manager.authorized { $0.value } }
        try await Task.sleep(for: .milliseconds(50))
        await gate.release()
        #expect(try await caller.value == "access-1")
        await restoring.value
        #expect(h.transport.count(refreshPath) == 1)
        #expect(h.store.value == "refresh-1")
    }

    @Test func signOutWhileOfflineStillClearsLocally() async throws {
        let h = Harness()
        try await h.signIn()
        h.transport.route(signOutPath) { _ in throw URLError(.notConnectedToInternet) }
        await h.manager.signOut()
        #expect(h.store.value == nil)
        #expect(await h.manager.state == .signedOut(.none))
        #expect(h.transport.count(signOutPath) == 1)
    }

    @Test func aSecond401SignsTheUserOut() async throws {
        let h = Harness()
        try await h.signIn()
        h.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        await #expect(throws: SessionError.signedOut) {
            try await h.manager.authorized { _ in throw APIError.unauthorized } as String
        }
        #expect(h.store.value == nil)
        #expect(await h.manager.state == .signedOut(.sessionEnded))
        #expect(h.transport.count(refreshPath) == 1)
    }

    @Test func aStoreSaveFailureAfterRotationKeepsTheNewCredentialInMemory() async throws {
        let h = Harness()
        try await h.signIn()
        h.store.setFailSaves(true)
        h.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        let result = try await h.manager.authorized(rejecting("access-1"))
        #expect(result == "access-2")
        #expect(h.store.value == "refresh-1") // the next launch will present the old credential and sign out
        #expect(await h.manager.state == .signedIn)
    }

    @Test func secretsAreRedactedInDescriptions() {
        let credential = DeviceCredential(refreshToken: "super-secret-refresh")
        let token = AccessToken(value: "super-secret-access")
        for text in [String(describing: credential), String(reflecting: credential),
                     String(describing: token), String(reflecting: token)] {
            #expect(!text.contains("super-secret"))
            #expect(text.contains("redacted"))
        }
    }
}
