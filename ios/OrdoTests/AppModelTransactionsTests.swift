import Foundation
import Testing
@testable import Ordo

private let createPath = "/api/auth/device-sessions"
private let refreshPath = "/api/auth/device-sessions/refresh"
private let signOutPath = "/api/auth/device-sessions/sign-out"
private let timelinePath = "/api/activity/timeline"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

/// The real `AppModel` over a stub transport and in-memory stores, signed in.
@MainActor private struct Rig {
    let transport = StubTransport()
    let credentials = InMemoryCredentialStore(initial: nil)
    let manager: SessionManager
    let model: AppModel

    init() {
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        manager = SessionManager(api: api, store: credentials)
        model = AppModel(session: manager, api: api, pendingStore: InMemoryPendingSaveStore(),
                         invalidationMark: isolatedDefaults(), language: .en, deviceLocale: TimelineFixtures.english)
        transport.route(signOutPath) { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
        transport.route(timelinePath) { _ in try StubResponse(200, fixture: "timeline-first-page") }
        transport.route(createPath) { _ in session("access-1", "refresh-1") }
    }

    func signIn() async throws {
        await model.start()
        _ = await waitUntil { await MainActor.run { model.sessionState == .signedOut(.none) } }
        try await manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { model.sessionState == .signedIn } })
        #expect(await waitUntil { transport.count("/api/home") == 1 })
    }

    func waitForState(_ state: SessionState) async -> Bool {
        await waitUntil { await MainActor.run { model.sessionState == state } }
    }

    var expense: TimelineItem { TimelineFixtures.item(.expense, id: 7, description: "Synthetic lunch", category: "Food") }
}

@MainActor @Suite struct AppModelTransactionsTests {
    @Test func openingTheListReadsTheTimelineThroughTheSession() async throws {
        let rig = try await Rig.signedIn()
        await rig.model.transactionsModel.loadIfNeeded()
        #expect(rig.transport.count(timelinePath) == 1)
        #expect(rig.model.transactionsModel.items.count == 3)
        let request = try #require(rig.transport.requests(timelinePath).first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    // MARK: Capture and Transactions

    @Test func aCaptureSaveRefreshesTransactionsOnceTheListHasBeenOpened() async throws {
        let rig = try await Rig.signedIn()
        rig.transport.route("/api/expenses") { _ in StubResponse(201) }
        await rig.model.transactionsModel.loadIfNeeded()
        #expect(rig.transport.count(timelinePath) == 1)
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(rig.transport.count("/api/home") == 2)
        #expect(rig.transport.count(timelinePath) == 2)
        #expect(capture.notice == .saved(.expense))
    }

    @Test func aCaptureSaveDoesNotReadTheListBeforeItWasOpened() async throws {
        let rig = try await Rig.signedIn()
        rig.transport.route("/api/inflows") { _ in StubResponse(201) }
        let capture = rig.model.captureModel
        capture.begin(.deposit)
        capture.edit { $0.description = "Synthetic refund"; $0.amountText = "20" }
        capture.submit()
        await capture.settled()
        #expect(rig.transport.count(timelinePath) == 0)
    }

    // MARK: One write at a time

    @Test func aSubmittingEditBlocksAddAndBlocksAcrossFeatures() async throws {
        let rig = try await Rig.signedIn()
        let gate = Gate()
        rig.transport.route("/api/expenses/7") { _ in await gate.wait(); return StubResponse(204, Data()) }
        #expect(!rig.model.isWriteInFlight)
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.submitEdit()
        #expect(rig.model.isWriteInFlight)
        #expect(await waitUntil { rig.transport.count("/api/expenses/7") == 1 })
        await gate.release()
        await mutation.settled()
        #expect(!rig.model.isWriteInFlight)
    }

    @Test func aSavingCaptureBlocksEditsAndDeletes() async throws {
        let rig = try await Rig.signedIn()
        let gate = Gate()
        rig.transport.route("/api/expenses") { _ in await gate.wait(); return StubResponse(201) }
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        #expect(rig.model.isWriteInFlight)
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.beginDelete(rig.expense)
        #expect(mutation.phase == .idle && !mutation.canStart)
        await gate.release()
        await capture.settled()
        mutation.beginEdit(rig.expense)
        #expect(mutation.phase == .editing)
    }

    @Test func aCaptureSaveWaitingAsUncertainDoesNotBlockBrowsingOrEditing() async throws {
        let rig = try await Rig.signedIn()
        rig.transport.route("/api/expenses") { _ in throw URLError(.timedOut) }
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(capture.phase == .uncertain && !rig.model.isWriteInFlight)
        rig.model.mutationModel.beginEdit(rig.expense)
        #expect(rig.model.mutationModel.phase == .editing)
    }

    // MARK: Changes refresh from the server

    @Test func anAppliedEditReReadsTheListAndHomeAndNeverChangesRowsLocally() async throws {
        let rig = try await Rig.signedIn()
        await rig.model.transactionsModel.loadIfNeeded()
        let before = rig.model.transactionsModel.items
        let gate = Gate()
        rig.transport.route("/api/expenses/7") { _ in await gate.wait(); return StubResponse(204, Data()) }
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.edit { $0.description = "Synthetic dinner"; $0.amountText = "99.99" }
        mutation.submitEdit()
        #expect(await waitUntil { rig.transport.count("/api/expenses/7") == 1 })
        #expect(rig.model.transactionsModel.items == before) // nothing optimistic
        await gate.release()
        await mutation.settled()
        #expect(rig.transport.count(timelinePath) == 2) // one read, one re-read after the change
        #expect(rig.transport.count("/api/home") == 2)
        #expect(mutation.notice == .updated(.expense))
    }

    @Test func aFailedListReReadAfterAChangeClearsTheRows() async throws {
        let rig = try await Rig.signedIn()
        await rig.model.transactionsModel.loadIfNeeded()
        rig.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        rig.transport.route(timelinePath) { _ in throw URLError(.notConnectedToInternet) }
        let mutation = rig.model.mutationModel
        await mutation.beginDeleteAndConfirm(rig.expense)
        #expect(rig.model.transactionsModel.items.isEmpty)
        #expect(rig.model.transactionsModel.phase == .failed(.offline))
        #expect(mutation.notice == .deletedRefreshFailed(.expense))
    }

    // MARK: Session

    @Test func a401RefreshesOnceAndResendsTheSameBytes() async throws {
        let rig = try await Rig.signedIn()
        let attempts = Counter()
        rig.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        rig.transport.route("/api/expenses/7") { request in
            if attempts.next() == 1 {
                #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
                return StubResponse(401)
            }
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
            return StubResponse(204, Data())
        }
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.edit { $0.amountText = "13.25" }
        mutation.submitEdit()
        await mutation.settled()
        let bodies = rig.transport.bodies("/api/expenses/7")
        #expect(bodies.count == 2 && bodies[0] == bodies[1])
        #expect(rig.transport.count(refreshPath) == 1)
        #expect(mutation.notice == .updated(.expense))
    }

    @Test func aRetryAfterAnUncertainOutcomeSendsTheSameBytes() async throws {
        let rig = try await Rig.signedIn()
        let attempts = Counter()
        rig.transport.route("/api/expenses/7") { _ in
            attempts.next() == 1 ? StubResponse(503) : StubResponse(204, Data())
        }
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.edit { $0.description = "Synthetic dinner" }
        mutation.submitEdit()
        await mutation.settled()
        #expect(mutation.phase == .uncertain)
        mutation.retry()
        await mutation.settled()
        let bodies = rig.transport.bodies("/api/expenses/7")
        #expect(bodies.count == 2 && bodies[0] == bodies[1])
        #expect(mutation.phase == .idle && mutation.notice == .updated(.expense))
    }

    @Test func sessionInvalidSignsOutAndDropsTheLateResponse() async throws {
        let rig = try await Rig.signedIn()
        await rig.model.transactionsModel.loadIfNeeded()
        let gate = Gate()
        rig.transport.route("/api/expenses/7") { _ in await gate.wait(); return StubResponse(401) }
        rig.transport.route(refreshPath) { _ in try StubResponse(401, fixture: "auth-session-invalid") }
        let mutation = rig.model.mutationModel
        mutation.beginDelete(rig.expense)
        mutation.confirmDelete()
        #expect(await waitUntil { rig.transport.count("/api/expenses/7") == 1 })
        await gate.release()
        #expect(await rig.waitForState(.signedOut(.sessionEnded)))
        await mutation.settled()
        #expect(mutation.phase == .idle && mutation.notice == nil && mutation.request == nil)
        #expect(rig.model.transactionsModel.phase == .loading && rig.model.transactionsModel.items.isEmpty)
        #expect(rig.transport.count(timelinePath) == 1) // no re-read after the session ended
    }

    @Test func signOutAndSignInResetEverything() async throws {
        let rig = try await Rig.signedIn()
        let transactions = rig.model.transactionsModel
        let mutation = rig.model.mutationModel
        await transactions.loadIfNeeded()
        transactions.setKind(.expense)
        await transactions.settled()
        rig.transport.route("/api/expenses/7") { _ in throw URLError(.timedOut) }
        await mutation.beginDeleteAndConfirm(rig.expense)
        #expect(mutation.phase == .uncertain)

        await rig.model.signOut()
        #expect(await rig.waitForState(.signedOut(.none)))
        #expect(transactions.phase == .loading && transactions.items.isEmpty)
        #expect(transactions.draft == TimelineFilter() && transactions.applied == TimelineFilter())
        #expect(mutation.phase == .idle && mutation.request == nil && mutation.notice == nil)

        try await rig.manager.signIn(email: "other@example.test", password: "synthetic-password")
        #expect(await rig.waitForState(.signedIn))
        #expect(transactions.phase == .loading && mutation.phase == .idle)
        await transactions.loadIfNeeded()
        #expect(transactions.items.count == 3)
        #expect(transactions.applied == TimelineFilter()) // filters are never carried over
    }
}

private extension Rig {
    static func signedIn() async throws -> Rig {
        let rig = Rig()
        try await rig.signIn()
        return rig
    }
}

private extension TransactionMutationViewModel {
    func beginDeleteAndConfirm(_ item: TimelineItem) async {
        beginDelete(item)
        confirmDelete()
        await settled()
    }
}
