import Foundation
import Testing
@testable import Ordo

private let createPath = "/api/auth/device-sessions"
private let refreshPath = "/api/auth/device-sessions/refresh"
private let signOutPath = "/api/auth/device-sessions/sign-out"
private let timelinePath = "/api/activity/timeline"
private let limitsPath = "/api/budgetlimits"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

private func queryItems(_ request: URLRequest) -> [String: String] {
    var result: [String: String] = [:]
    for item in URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? [] { result[item.name] = item.value }
    return result
}

/// The real `AppModel` over a stub transport and in-memory stores, signed in. The app clock is the
/// real one, so the stubs answer for whatever month and range the request names.
@MainActor private struct Rig {
    let transport = StubTransport()
    let credentials = InMemoryCredentialStore(initial: nil)
    let manager: SessionManager
    let model: AppModel
    let limitRows = Cell(#"[{"id":11,"category":"food","limitAmount":200.00},{"id":12,"category":"transport","limitAmount":50.50}]"#)

    init() {
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        manager = SessionManager(api: api, store: credentials)
        model = AppModel(session: manager, api: api, pendingStore: InMemoryPendingSaveStore(),
                         invalidationMark: isolatedDefaults(), language: .en, deviceLocale: TimelineFixtures.english)
        transport.route(signOutPath) { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
        transport.route(createPath) { _ in session("access-1", "refresh-1") }
        let rows = limitRows
        transport.route(limitsPath) { request in
            if request.httpMethod == "POST" { return StubResponse(200, json: "{}") }
            let key = queryItems(request)["monthYear"] ?? ""
            // Every row names the month that was asked for, as the server does.
            let json = rows.value.replacingOccurrences(of: "\"limitAmount\"", with: "\"monthYear\":\"\(key)-01T00:00:00Z\",\"limitAmount\"")
            return StubResponse(200, json: json)
        }
        transport.route(timelinePath) { request in
            let query = queryItems(request)
            // A budget spending read names kind=expense and a range; answer with one expense on its first day.
            if let from = query["from"], query["kind"] == "expense" {
                return StubResponse(200, json: """
                {"currencyCode":"USD","items":[{"kind":"expense","recordId":71,"date":"\(from)","amount":"10.00","description":"Synthetic lunch","category":"food","paycheck":null}],"page":{"limit":100,"hasMore":false,"nextCursor":null}}
                """)
            }
            return try StubResponse(200, fixture: "timeline-first-page")
        }
    }

    static func signedIn() async throws -> Rig {
        let rig = Rig()
        await rig.model.start()
        _ = await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } }
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedIn } })
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        return rig
    }

    func waitForState(_ state: SessionState) async -> Bool {
        await waitUntil { await MainActor.run { model.sessionState == state } }
    }

    var spendingReads: Int {
        transport.requests(timelinePath).filter { queryItems($0)["limit"] == "100" && queryItems($0)["kind"] == "expense" }.count
    }

    var currentMonthKey: String { BudgetMonth.current(now: Date(), timeZone: .current).key }

    var expense: TimelineItem { TimelineFixtures.item(.expense, id: 7, description: "Synthetic lunch", category: "Food") }

    func addFood() {
        model.budgetsModel.beginAdd()
        model.budgetsModel.edit { $0.choice = .food; $0.amountText = "75" }
        model.budgetsModel.save()
    }
}

@MainActor @Suite struct AppModelBudgetsTests {
    @Test func openingBudgetsReadsLimitsAndSpendingThroughTheSession() async throws {
        let rig = try await Rig.signedIn()
        await rig.model.budgetsModel.loadIfNeeded()
        let limits = try #require(rig.transport.requests(limitsPath).first)
        #expect(limits.httpMethod == "GET" && queryItems(limits) == ["monthYear": rig.currentMonthKey])
        #expect(limits.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(rig.spendingReads == 1)
        #expect(rig.model.budgetsModel.shownRows.count == 2)
        #expect(rig.model.budgetsModel.spending != .failed)
    }

    // MARK: Changes refresh from the server

    @Test func anUpsertSendsTheExactBytesThenReReadsTheLimitsAndHomeOnce() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        rig.addFood()
        await budgets.settled()
        let post = try #require(rig.transport.requests(limitsPath).first { $0.httpMethod == "POST" })
        #expect(String(decoding: try #require(post.httpBody), as: UTF8.self)
                == #"{"category":"food","limitAmount":75.00,"monthYear":"\#(rig.currentMonthKey)-01"}"#)
        #expect(post.value(forHTTPHeaderField: "Idempotency-Key") == nil)
        #expect(rig.transport.requests(limitsPath).filter { $0.httpMethod == "GET" }.count == 2) // one read, one re-read
        #expect(rig.transport.count("/api/home") == 2)
        #expect(rig.spendingReads == 1) // a budget write does not change spending
        #expect(budgets.feedback == .saved && !budgets.needsRefresh)
    }

    @Test func aDeleteSendsTheRowIdAndTreatsA404AsGone() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        rig.transport.route("/api/budgetlimits/11") { _ in StubResponse(404, json: #"{"title":"Not Found","status":404}"#) }
        let row = try #require(budgets.shownRows.first)
        budgets.beginDelete(row)
        budgets.confirmDelete()
        await budgets.settled()
        #expect(rig.transport.requests("/api/budgetlimits/11").first?.httpMethod == "DELETE")
        #expect(budgets.feedback == .deleted && rig.transport.count("/api/home") == 2)
    }

    @Test func aCaptureSaveRefreshesBudgetSpendingOnceTheScreenWasOpened() async throws {
        let rig = try await Rig.signedIn()
        rig.transport.route("/api/expenses") { _ in StubResponse(201) }
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        await capture.settled()
        #expect(rig.spendingReads == 0) // Budgets was never opened

        await rig.model.budgetsModel.loadIfNeeded()
        #expect(rig.spendingReads == 1)
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic dinner"; $0.amountText = "20" }
        capture.submit()
        await capture.settled()
        #expect(rig.spendingReads == 2)
        #expect(rig.transport.requests(limitsPath).filter { $0.httpMethod == "GET" }.count == 1) // limits are not read again
    }

    @Test func aTransactionsEditRefreshesBudgetSpending() async throws {
        let rig = try await Rig.signedIn()
        rig.transport.route("/api/expenses/7") { _ in StubResponse(204, Data()) }
        await rig.model.budgetsModel.loadIfNeeded()
        #expect(rig.spendingReads == 1)
        let mutation = rig.model.mutationModel
        mutation.beginDelete(rig.expense)
        mutation.confirmDelete()
        await mutation.settled()
        #expect(rig.spendingReads == 2)
        #expect(mutation.notice == .deleted(.expense))
    }

    // MARK: One write at a time

    @Test func aBudgetWriteBlocksCaptureAndTransactionEditsAndTheReverse() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        let gate = Gate()
        rig.transport.route(limitsPath) { request in
            if request.httpMethod == "POST" { await gate.wait(); return StubResponse(200, json: "{}") }
            return StubResponse(200, json: "[]")
        }
        #expect(!rig.model.isWriteInFlight)
        rig.addFood()
        #expect(rig.model.isWriteInFlight && budgets.isWriting)
        #expect(await waitUntil { rig.transport.requests(limitsPath).contains { $0.httpMethod == "POST" } })
        let mutation = rig.model.mutationModel
        mutation.beginEdit(rig.expense)
        mutation.beginDelete(rig.expense)
        #expect(mutation.phase == .idle && !mutation.canStart)
        await gate.release()
        await budgets.settled()
        #expect(!rig.model.isWriteInFlight)
        mutation.beginEdit(rig.expense)
        #expect(mutation.phase == .editing)
        mutation.cancelEditing()

        // The other way round: a capture save and a Transactions edit block budget changes.
        let saveGate = Gate()
        rig.transport.route("/api/expenses") { _ in await saveGate.wait(); return StubResponse(201) }
        let capture = rig.model.captureModel
        capture.begin(.expense)
        capture.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5" }
        capture.submit()
        #expect(capture.phase == .saving && !budgets.canAdd)
        budgets.beginAdd()
        #expect(budgets.task == nil)
        await saveGate.release()
        await capture.settled()

        let editGate = Gate()
        rig.transport.route("/api/expenses/7") { _ in await editGate.wait(); return StubResponse(204, Data()) }
        mutation.beginEdit(rig.expense)
        mutation.submitEdit()
        #expect(mutation.isSubmitting && !budgets.canAdd)
        await editGate.release()
        await mutation.settled()
        #expect(budgets.canAdd)
    }

    // MARK: Session

    @Test func a401RefreshesOnceAndResendsTheSameBytes() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        let attempts = Counter()
        rig.transport.route(refreshPath) { _ in session("access-2", "refresh-2") }
        let limitRows = rig.limitRows
        rig.transport.route(limitsPath) { request in
            if request.httpMethod == "POST" {
                if attempts.next() == 1 {
                    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
                    return StubResponse(401)
                }
                #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
                return StubResponse(200, json: "{}")
            }
            return StubResponse(200, json: limitRows.value.replacingOccurrences(
                of: "\"limitAmount\"", with: "\"monthYear\":\"\(queryItems(request)["monthYear"] ?? "")-01\",\"limitAmount\""))
        }
        rig.addFood()
        await budgets.settled()
        let bodies = rig.transport.bodies(limitsPath)
        #expect(bodies.count == 2 && bodies[0] == bodies[1])
        #expect(rig.transport.count(refreshPath) == 1)
        #expect(budgets.feedback == .saved)
    }

    @Test func sessionInvalidSignsOutAndDropsTheLateResponse() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        let gate = Gate()
        rig.transport.route(limitsPath) { request in
            if request.httpMethod == "POST" { await gate.wait(); return StubResponse(401) }
            return StubResponse(200, json: "[]")
        }
        rig.transport.route(refreshPath) { _ in try StubResponse(401, fixture: "auth-session-invalid") }
        rig.addFood()
        #expect(await waitUntil { rig.transport.requests(limitsPath).contains { $0.httpMethod == "POST" } })
        await gate.release()
        #expect(await rig.waitForState(.signedOut(.sessionEnded)))
        await budgets.settled()
        #expect(budgets.task == nil && budgets.feedback == nil && !budgets.isPending)
        #expect(budgets.limits == .loading && budgets.shownRows.isEmpty)
        #expect(rig.transport.requests(limitsPath).filter { $0.httpMethod == "GET" }.count == 1) // no re-read after the session ended
        #expect(rig.transport.count("/api/home") == 1)
    }

    @Test func signOutAndSignInResetEverything() async throws {
        let rig = try await Rig.signedIn()
        let budgets = rig.model.budgetsModel
        await budgets.loadIfNeeded()
        budgets.stepMonth(by: -1)
        await budgets.settled()
        rig.transport.route(limitsPath) { request in
            request.httpMethod == "POST" ? StubResponse(503) : StubResponse(200, json: "[]")
        }
        rig.addFood()
        await budgets.settled()
        #expect(budgets.needsRefresh && budgets.feedback == .unconfirmed)

        await rig.model.signOut()
        #expect(await rig.waitForState(.signedOut(.none)))
        #expect(budgets.limits == .loading && budgets.spending == .loading && budgets.shownRows.isEmpty)
        #expect(budgets.task == nil && budgets.feedback == nil && !budgets.needsRefresh && !budgets.isPending)
        #expect(budgets.month.key == rig.currentMonthKey) // the month is never carried over

        try await rig.manager.signIn(email: "other@example.test", password: "synthetic-password")
        #expect(await rig.waitForState(.signedIn))
        #expect(budgets.limits == .loading)
        await budgets.loadIfNeeded()
        #expect(budgets.limits == .loaded([]))
    }
}
