import Foundation
import Testing
@testable import Ordo

private let createPath = "/api/auth/device-sessions"
private let refreshPath = "/api/auth/device-sessions/refresh"
private let signOutPath = "/api/auth/device-sessions/sign-out"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

/// Builds the real `AppModel` over a stub transport and in-memory stores.
@MainActor private struct AppRig {
    let transport = StubTransport()
    let credentials: InMemoryCredentialStore
    let pending: InMemoryPendingSaveStore
    let manager: SessionManager
    let model: AppModel
    let mark = isolatedDefaults()

    init(credential: String?, pending record: PendingSaveLoad) {
        credentials = InMemoryCredentialStore(initial: credential)
        pending = InMemoryPendingSaveStore(record)
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        manager = SessionManager(api: api, store: credentials)
        model = AppModel(session: manager, api: api, pendingStore: pending, invalidationMark: mark, language: .en,
                         deviceLocale: CaptureFixtures.english)
        transport.route(signOutPath) { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
    }

    func start() async { await model.start() }

    func waitForState(_ state: SessionState) async -> Bool {
        await waitUntil { await MainActor.run { model.sessionState == state } }
    }
}

@MainActor @Suite struct AppModelCaptureTests {
    private let record = CaptureFixtures.save()

    @Test func aRestoredSessionSurfacesTheStoredSave() async {
        let rig = AppRig(credential: "refresh-0", pending: .record(record))
        rig.transport.route(refreshPath) { _ in session("access-1", "refresh-1") }
        await rig.start()
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.model.captureModel.phase == .uncertain)
        #expect(rig.model.captureModel.pending == record)
        #expect(rig.pending.current == .record(record)) // still on disk
    }

    @Test func anOfflineRestoreStillSurfacesTheStoredSave() async {
        let rig = AppRig(credential: "refresh-0", pending: .record(record))
        rig.transport.route(refreshPath) { _ in throw URLError(.notConnectedToInternet) }
        await rig.start()
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.model.captureModel.phase == .uncertain)
        #expect(rig.pending.current == .record(record))
    }

    @Test func theLaunchTimeSignedOutStateKeepsTheRecordButDoesNotShowIt() async {
        // No credential, or a transient Keychain failure: restore() ends in .signedOut(.none).
        let rig = AppRig(credential: nil, pending: .record(record))
        await rig.start()
        #expect(await rig.waitForState(.signedOut(.none)))
        #expect(rig.model.captureModel.phase == .idle)
        #expect(rig.pending.current == .record(record))
        #expect(rig.pending.clears == 0)
    }

    @Test func restoringNeverClearsTheRecord() async {
        let rig = AppRig(credential: "refresh-0", pending: .record(record))
        let gate = Gate()
        rig.transport.route(refreshPath) { _ in await gate.wait(); return session("access-1", "refresh-1") }
        let starting = Task { await rig.start() }
        #expect(await waitUntil { rig.transport.count(refreshPath) == 1 })
        #expect(rig.model.sessionState == .restoring)
        #expect(rig.pending.current == .record(record))
        #expect(rig.model.captureModel.phase == .idle)
        await gate.release()
        await starting.value
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.model.captureModel.phase == .uncertain)
    }

    @Test func anEndedSessionAtRestoreClearsTheRecord() async throws {
        let rig = AppRig(credential: "refresh-0", pending: .record(record))
        rig.transport.route(refreshPath) { _ in try StubResponse(401, fixture: "auth-session-invalid") }
        await rig.start()
        #expect(await rig.waitForState(.signedOut(.sessionEnded)))
        #expect(await waitUntil { rig.pending.current == .none })
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func aFreshSignInRemovesALeftoverRecord() async throws {
        let rig = AppRig(credential: nil, pending: .record(record))
        await rig.start()
        #expect(await rig.waitForState(.signedOut(.none)))
        rig.transport.route(createPath) { _ in session("access-1", "refresh-1") }
        try await rig.manager.signIn(email: "other@example.test", password: "synthetic-password")
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.pending.current == .none)
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func aLeftoverThatCannotBeDeletedAtSignInIsSuppressedForTheRun() async throws {
        let rig = AppRig(credential: nil, pending: .record(record))
        rig.pending.setFailClears(true)
        await rig.start()
        #expect(await rig.waitForState(.signedOut(.none)))
        rig.transport.route(createPath) { _ in session("access-1", "refresh-1") }
        try await rig.manager.signIn(email: "other@example.test", password: "synthetic-password")
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.pending.current == .record(record)) // the delete failed
        #expect(rig.mark.bool(forKey: CaptureViewModel.invalidationMarkKey)) // so the next launch retries it
        #expect(rig.model.captureModel.phase == .idle) // but it is never shown to the new account
        rig.model.captureModel.surfaceStoredRecord()
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func signOutRemovesTheRecord() async {
        let rig = AppRig(credential: "refresh-0", pending: .record(record))
        rig.transport.route(refreshPath) { _ in session("access-1", "refresh-1") }
        await rig.start()
        #expect(await rig.waitForState(.signedIn))
        #expect(rig.model.captureModel.needsSignOutWarning)
        await rig.model.signOut()
        #expect(rig.pending.current == .none)
        #expect(rig.model.captureModel.phase == .idle)
        #expect(await rig.waitForState(.signedOut(.none)))
    }

    @Test func aSaveRefreshesHomeFromTheServer() async throws {
        let rig = AppRig(credential: nil, pending: .none)
        rig.transport.route(createPath) { _ in session("access-1", "refresh-1") }
        rig.transport.route("/api/expenses") { _ in StubResponse(201) }
        await rig.start()
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await rig.waitForState(.signedIn))
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(rig.transport.count("/api/home") == 2) // one initial load, one refresh after the save
        #expect(capture.notice == .saved(.expense))
        if case .loaded = rig.model.homeModel.phase {} else { Issue.record("Home did not reload") }
    }
}
