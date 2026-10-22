import Foundation
import Testing
@testable import Ordo

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

@MainActor private struct RecurringRig {
    let transport = StubTransport()
    let credentials = InMemoryCredentialStore(initial: nil)
    let manager: SessionManager
    let model: AppModel

    init() {
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        manager = SessionManager(api: api, store: credentials)
        model = AppModel(session: manager, api: api, pendingStore: InMemoryPendingSaveStore(),
                         invalidationMark: isolatedDefaults(), language: .en, deviceLocale: TimelineFixtures.english)
        transport.route("/api/auth/device-sessions/sign-out") { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
        transport.route("/api/auth/device-sessions") { _ in session("access-1", "refresh-1") }
        transport.route("/api/activity/timeline") { _ in try StubResponse(200, fixture: "timeline-first-page") }
        transport.route("/api/commitment-candidates") { _ in StubResponse(200, json: #"{"candidates":[],"dismissedCandidates":[]}"#) }
        transport.route("/api/commitments") { _ in StubResponse(200, json: "[]") }
        transport.route("/api/commitment-changes") { _ in StubResponse(200, json: #"{"evaluatedOn":"2026-10-01","changes":[]}"#) }
        transport.route("/api/paychecks") { _ in try StubResponse(200, fixture: "paychecks-full") }
        transport.route("/api/inflows") { _ in StubResponse(201, json: "{}") }
        transport.route("/api/expenses") { _ in StubResponse(201, json: "{}") }
    }

    static func signedIn() async throws -> RecurringRig {
        let rig = RecurringRig()
        await rig.model.start()
        _ = await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } }
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedIn } })
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        return rig
    }
}

@MainActor @Suite struct AppModelRecurringTests {
    @Test func anUnopenedTabIsNotReadByOtherScreensWrites() async throws {
        let rig = try await RecurringRig.signedIn()
        await rig.model.recurringModel.refreshIfLoaded()
        #expect(rig.transport.count("/api/commitment-candidates") == 0 && rig.transport.count("/api/commitments") == 0)
    }

    @Test func anExpenseSavedFromCaptureRefreshesRecurringOnceOpened() async throws {
        let rig = try await RecurringRig.signedIn()
        await rig.model.recurringModel.loadIfNeeded()
        #expect(rig.transport.count("/api/commitment-candidates") == 1 && rig.transport.count("/api/commitments") == 1)
        rig.model.captureModel.begin(.expense)
        rig.model.captureModel.edit { $0.description = "Synthetic"; $0.amountText = "5.00" }
        rig.model.captureModel.submit()
        await rig.model.captureModel.settled()
        #expect(await waitUntil { rig.transport.count("/api/commitment-candidates") == 2 })
    }

    @Test func anAppliedRecurringWriteReadsBothListsAndHomeAgain() async throws {
        let rig = try await RecurringRig.signedIn()
        rig.transport.route("/api/commitment-candidates") { _ in
            StubResponse(200, json: #"{"candidates":[],"dismissedCandidates":[]}"#)
        }
        rig.transport.route("/api/commitments") { _ in
            StubResponse(200, json: #"[{"id":"\#(RecurringFixtures.id1)","name":"Synthetic Rent","lifecycle":"active","evidence":[]}]"#)
        }
        rig.transport.route("/api/commitments/\(RecurringFixtures.id1)/lifecycle") { _ in StubResponse(200, json: "{}") }
        let model = rig.model.recurringModel
        await model.loadIfNeeded()
        let commitment = try #require(model.commitments(in: .active).first)
        let homeBefore = rig.transport.count("/api/home")
        model.perform(.pause, on: commitment)
        await model.settled()
        #expect(rig.transport.count("/api/commitments") == 2 && rig.transport.count("/api/commitment-candidates") == 2)
        #expect(rig.transport.count("/api/home") == homeBefore + 1)
    }

    @Test func oneWriteInFlightBlocksTheOthersInAllDirections() async throws {
        let rig = try await RecurringRig.signedIn()
        let gate = Gate()
        rig.transport.route("/api/commitments") { _ in
            StubResponse(200, json: #"[{"id":"\#(RecurringFixtures.id1)","name":"Synthetic Rent","lifecycle":"active","evidence":[]}]"#)
        }
        rig.transport.route("/api/commitments/\(RecurringFixtures.id1)/lifecycle") { _ in await gate.wait(); return StubResponse(200, json: "{}") }
        let model = rig.model.recurringModel
        await model.loadIfNeeded()
        model.perform(.pause, on: try #require(model.commitments(in: .active).first))
        #expect(model.isWriting && rig.model.isWriteInFlight)
        #expect(!rig.model.paychecksModel.canWrite)
        await gate.release()
        await model.settled()
        #expect(!rig.model.isWriteInFlight)
    }

    @Test func signOutResetsTheRecurringModel() async throws {
        let rig = try await RecurringRig.signedIn()
        await rig.model.recurringModel.loadIfNeeded()
        #expect(rig.model.recurringModel.listState == .loaded)
        await rig.model.signOut()
        #expect(rig.model.recurringModel.listState == .idle && rig.model.recurringModel.snapshot == nil)
    }

    @Test func openingTheReviewsSelectsPlanRecurringAndAsksToScroll() async throws {
        let rig = try await RecurringRig.signedIn()
        #expect(rig.model.selectedTab == .home && rig.model.planSection == .budgets && !rig.model.scrollToChanges)
        #expect(rig.model.openRecurringReviews())
        #expect(rig.model.selectedTab == .plan && rig.model.planSection == .recurring && rig.model.scrollToChanges)
    }

    @Test func openingTheReviewsIsRefusedWhileAWriteIsInFlight() async throws {
        let rig = try await RecurringRig.signedIn()
        let gate = Gate()
        rig.transport.route("/api/commitments") { _ in
            StubResponse(200, json: #"[{"id":"\#(RecurringFixtures.id1)","name":"Synthetic Rent","lifecycle":"active","evidence":[]}]"#)
        }
        rig.transport.route("/api/commitments/\(RecurringFixtures.id1)/lifecycle") { _ in await gate.wait(); return StubResponse(200, json: "{}") }
        let model = rig.model.recurringModel
        await model.loadIfNeeded()
        model.perform(.pause, on: try #require(model.commitments(in: .active).first))
        #expect(rig.model.isWriteInFlight)
        #expect(!rig.model.openRecurringReviews())
        #expect(rig.model.selectedTab == .home && rig.model.planSection == .budgets && !rig.model.scrollToChanges)
        await gate.release()
        await model.settled()
        #expect(rig.model.openRecurringReviews())
    }

    @Test func aChangeDecisionIsAWriteInFlightForTheWholeApp() async throws {
        let rig = try await RecurringRig.signedIn()
        let gate = Gate()
        let fp = RecurringFixtures.fp1
        rig.transport.route("/api/commitment-changes") { _ in
            StubResponse(200, json: ChangeFixtures.body(amount: ChangeFixtures.amountJSON(fp)))
        }
        rig.transport.route("/api/commitment-changes/\(RecurringFixtures.id1)/amount/keep") { _ in
            await gate.wait(); return StubResponse(204, Data())
        }
        let model = rig.model.recurringModel
        await model.loadIfNeeded()
        let change = try #require(model.pendingChanges.first)
        model.decide(.keep, commitmentId: change.id, assessmentId: change.assessments[0].id)
        #expect(model.isWriting && rig.model.isWriteInFlight && !rig.model.canChangeLanguage)
        #expect(!rig.model.openRecurringReviews())
        await gate.release()
        await model.settled()
        #expect(!rig.model.isWriteInFlight && model.notice == .keptCurrent)
    }
}

