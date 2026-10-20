import Foundation
import Testing
@testable import Ordo

private let cashFlowPath = "/api/analytics/cash-flow"
private let refreshPath = "/api/auth/device-sessions/refresh"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

@MainActor private struct ReportsRig {
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
        transport.route("/api/paychecks") { _ in try StubResponse(200, fixture: "paychecks-full") }
        transport.route("/api/expenses") { _ in StubResponse(201) }
        transport.route("/api/inflows") { _ in StubResponse(201, json: "{}") }
        transport.route("/api/budgetlimits") { request in
            request.httpMethod == "POST" ? StubResponse(200, json: "{}") : StubResponse(200, json: "[]")
        }
        // The stub answers for whatever month and day the request names (the app clock is the real one).
        transport.route(cashFlowPath) { request in
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let month = items.first { $0.name == "month" }?.value ?? ""
            let through = items.first { $0.name == "throughDate" }?.value ?? ""
            return StubResponse(200, json: ReportsFixtures.json(month: month, through: through, available: [month]))
        }
    }

    static func signedIn() async throws -> ReportsRig {
        let rig = ReportsRig()
        await rig.model.start()
        _ = await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } }
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedIn } })
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        return rig
    }

    nonisolated var reads: Int { transport.count(cashFlowPath) }
}

@MainActor @Suite struct AppModelReportsTests {
    @Test func openingReportsReadsOnceThroughTheSession() async throws {
        let rig = try await ReportsRig.signedIn()
        await rig.model.reportsModel.loadIfNeeded()
        let request = try #require(rig.transport.requests(cashFlowPath).first)
        #expect(request.httpMethod == "GET" && request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name)
        #expect(items == ["month", "throughDate"] && rig.reads == 1)
        guard case .loaded = rig.model.reportsModel.phase else { Issue.record("not loaded"); return }
    }

    @Test func a401RefreshesTheSessionAndSendsTheSameRequestAgain() async throws {
        let rig = try await ReportsRig.signedIn()
        let first = Cell(true)
        rig.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        rig.transport.route(cashFlowPath) { request in
            if first.value { first.value = false; return StubResponse(401) }
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let month = items.first { $0.name == "month" }?.value ?? ""
            let through = items.first { $0.name == "throughDate" }?.value ?? ""
            return StubResponse(200, json: ReportsFixtures.json(month: month, through: through))
        }
        await rig.model.reportsModel.loadIfNeeded()
        let requests = rig.transport.requests(cashFlowPath)
        #expect(requests.count == 2 && requests[0].url == requests[1].url)
        #expect(requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
        guard case .loaded = rig.model.reportsModel.phase else { Issue.record("not loaded"); return }
    }

    @Test func anUnopenedTabIsNotReadByWritesElsewhere() async throws {
        let rig = try await ReportsRig.signedIn()
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(rig.reads == 0)
    }

    @Test func aCaptureSaveRefreshesReportsOnceOpened() async throws {
        let rig = try await ReportsRig.signedIn()
        await rig.model.reportsModel.loadIfNeeded()
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(await waitUntil { rig.reads == 2 })
        capture.begin(.deposit)
        capture.edit { $0.description = "Synthetic"; $0.amountText = "5.00" }
        capture.submit()
        await capture.settled()
        #expect(await waitUntil { rig.reads == 3 })
    }

    @Test func aTransactionsDeleteRefreshesReports() async throws {
        let rig = try await ReportsRig.signedIn()
        rig.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        await rig.model.reportsModel.loadIfNeeded()
        let expense = TimelineFixtures.item(.expense, id: 7, description: "Synthetic lunch", category: "Food")
        rig.model.mutationModel.beginDelete(expense)
        rig.model.mutationModel.confirmDelete()
        await rig.model.mutationModel.settled()
        #expect(await waitUntil { rig.reads == 2 })
    }

    @Test func aPaychecksWriteRefreshesReports() async throws {
        let rig = try await ReportsRig.signedIn()
        let paychecks = rig.model.paychecksModel
        await paychecks.loadIfNeeded()
        await rig.model.reportsModel.loadIfNeeded()
        let profile = try #require(paychecks.snapshot?.profiles.first { $0.lifecycle == .active })
        rig.transport.route("/api/paychecks/\(profile.id)/lifecycle") { _ in StubResponse(200, json: "{}") }
        paychecks.perform(.pause, on: profile)
        await paychecks.settled()
        #expect(await waitUntil { rig.reads == 2 })
    }

    @Test func budgetsAndRecurringWritesDoNotRefreshReports() async throws {
        let rig = try await ReportsRig.signedIn()
        await rig.model.reportsModel.loadIfNeeded()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        budgets.beginAdd()
        budgets.edit { $0.choice = .food; $0.amountText = "75" }
        budgets.save()
        await budgets.settled()
        #expect(rig.reads == 1)
        await rig.model.recurringModel.refreshIfLoaded() // unopened: nothing happens
        #expect(rig.reads == 1)
    }

    @Test func reportsIsNotAWriteAndSignOutResetsIt() async throws {
        let rig = try await ReportsRig.signedIn()
        await rig.model.reportsModel.loadIfNeeded()
        #expect(!rig.model.isWriteInFlight)
        await rig.model.signOut()
        #expect(rig.model.reportsModel.phase == .idle && rig.model.reportsModel.availableMonths.isEmpty)
    }
}
