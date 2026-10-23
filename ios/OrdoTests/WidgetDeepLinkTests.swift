import Foundation
import Testing
@testable import Ordo

@Suite struct WidgetDeepLinkParserTests {
    @Test func acceptsTheTwoExactLinks() {
        #expect(WidgetDeepLink.parse(URL(string: "ordo-widget://capture/expense")!) == .addExpense)
        #expect(WidgetDeepLink.parse(URL(string: "ordo-widget://capture/deposit")!) == .addDeposit)
    }

    @Test func theWidgetBuildsLinksTheAppAccepts() {
        #expect(WidgetDeepLink.parse(WidgetDeepLink.addExpense.url) == .addExpense)
        #expect(WidgetDeepLink.parse(WidgetDeepLink.addDeposit.url) == .addDeposit)
    }

    @Test(arguments: [
        "ordo-widget://capture",
        "ordo-widget://capture/",
        "ordo-widget://capture/expense/",
        "ordo-widget://capture/expense/extra",
        "ordo-widget://capture/income",
        "ordo-widget://capture/Expense",
        "ordo-widget://other/expense",
        "ordo-widget://capture/expense?amount=5",
        "ordo-widget://capture/expense?",
        "ordo-widget://capture/expense#x",
        "ordo-widget://capture/expense#",
        "ordo-widget://user@capture/expense",
        "ordo-widget://user:pw@capture/expense",
        "ordo-widget://capture:80/expense",
        "ordo-widget:///capture/expense",
        "ordo-widget:capture/expense",
        "ordo://capture/expense",
        "ORDO-WIDGET://capture/expense",
        "https://capture/expense",
        "https://example.test/ordo-widget://capture/expense",
    ])
    func ignoresEverythingElse(text: String) {
        #expect(WidgetDeepLink.parse(URL(string: text)!) == nil)
    }

    @Test func theSchemeIsNotRegisteredInTheAppInfoPlist() {
        // The hosted app is the main bundle of the test process.
        #expect(Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") == nil)
    }
}

private let createPath = "/api/auth/device-sessions"
private let refreshPath = "/api/auth/device-sessions/refresh"
private let signOutPath = "/api/auth/device-sessions/sign-out"

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

@MainActor private struct RouterRig {
    let transport = StubTransport()
    let credentials: InMemoryCredentialStore
    let pending: InMemoryPendingSaveStore
    let model: AppModel
    let mark = isolatedDefaults()

    init(credential: String?, pending record: PendingSaveLoad = .none) {
        credentials = InMemoryCredentialStore(initial: credential)
        pending = InMemoryPendingSaveStore(record)
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        let manager = SessionManager(api: api, store: credentials)
        model = AppModel(session: manager, api: api, pendingStore: pending, invalidationMark: mark, language: .en,
                         deviceLocale: CaptureFixtures.english)
        transport.route(signOutPath) { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
    }

    func waitForState(_ state: SessionState) async -> Bool {
        await waitUntil { await MainActor.run { model.sessionState == state } }
    }

    var writeRequests: Int { transport.count("/api/expenses") + transport.count("/api/inflows") }
}

private let expenseLink = URL(string: "ordo-widget://capture/expense")!
private let depositLink = URL(string: "ordo-widget://capture/deposit")!

@MainActor @Suite struct WidgetRouterTests {
    private func signedIn() async -> RouterRig {
        let rig = RouterRig(credential: "refresh-0")
        rig.transport.route(refreshPath) { _ in session("access-1", "refresh-1") }
        await rig.model.start()
        #expect(await rig.waitForState(.signedIn))
        return rig
    }

    @Test func signedInOpensTheExpenseForm() async {
        let rig = await signedIn()
        rig.model.selectedTab = .settings
        rig.model.handle(expenseLink)
        #expect(rig.model.selectedTab == .home)
        #expect(rig.model.captureModel.phase == .editing)
        #expect(rig.model.captureModel.kind == .expense)
        #expect(rig.model.captureModel.isSheetPresented)
        #expect(rig.writeRequests == 0)
    }

    @Test func signedInOpensTheDepositForm() async {
        let rig = await signedIn()
        rig.model.handle(depositLink)
        #expect(rig.model.captureModel.phase == .editing)
        #expect(rig.model.captureModel.kind == .deposit)
        #expect(rig.writeRequests == 0)
    }

    @Test func aMalformedLinkDoesNothing() async {
        let rig = await signedIn()
        rig.model.selectedTab = .settings
        rig.model.handle(URL(string: "ordo-widget://capture/expense?amount=5")!)
        #expect(rig.model.selectedTab == .settings)
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func anOpenFormIsNeverReplaced() async {
        let rig = await signedIn()
        rig.model.handle(expenseLink)
        rig.model.captureModel.edit { $0.description = "Lunch" }
        rig.model.handle(depositLink)
        #expect(rig.model.captureModel.kind == .expense)
        #expect(rig.model.captureModel.draft.description == "Lunch")
    }

    @Test func anOpenSheetOnAnotherTabBlocksTheLink() async {
        let rig = await signedIn()
        rig.model.selectedTab = .activity
        rig.model.transactionsModel.isFiltersPresented = true
        rig.model.handle(expenseLink)
        #expect(rig.model.selectedTab == .activity)
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func anOpenImportOrRowEditorBlocksTheLink() async {
        let rig = await signedIn()
        rig.model.selectedTab = .activity
        rig.model.importModel.isPresented = true
        rig.model.handle(expenseLink)
        #expect(rig.model.selectedTab == .activity)
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func theSignOutConfirmationBlocksTheLink() async {
        let rig = await signedIn()
        rig.model.selectedTab = .settings
        rig.model.isConfirmingSignOut = true
        rig.model.handle(expenseLink)
        #expect(rig.model.selectedTab == .settings)
        #expect(rig.model.captureModel.phase == .idle)
    }

    @Test func aWaitingSaveIsNeverDiscardedOrReplaced() async {
        let record = CaptureFixtures.save()
        let rig = RouterRig(credential: "refresh-0", pending: .record(record))
        rig.transport.route(refreshPath) { _ in session("access-1", "refresh-1") }
        await rig.model.start()
        #expect(await rig.waitForState(.signedIn))
        rig.model.captureModel.sheetDismissed()
        rig.model.selectedTab = .settings
        rig.model.handle(expenseLink)
        #expect(rig.model.selectedTab == .home)
        #expect(rig.model.captureModel.phase == .uncertain)
        #expect(rig.model.captureModel.pending == record)
        #expect(rig.pending.current == .record(record))
        #expect(rig.writeRequests == 0)
    }

    @Test func aLinkWhileRestoringIsHeldAndAppliedWhenSignedIn() async {
        let rig = RouterRig(credential: "refresh-0")
        let gate = Gate()
        rig.transport.route(refreshPath) { _ in await gate.wait(); return session("access-1", "refresh-1") }
        let starting = Task { await rig.model.start() }
        #expect(await waitUntil { rig.transport.count(refreshPath) == 1 })
        #expect(rig.model.sessionState == .restoring)
        rig.model.handle(depositLink)
        #expect(rig.model.captureModel.phase == .idle)
        await gate.release()
        #expect(await rig.waitForState(.signedIn))
        #expect(await waitUntil { await MainActor.run { rig.model.captureModel.phase == .editing } })
        #expect(rig.model.captureModel.kind == .deposit)
        await starting.value
        #expect(rig.writeRequests == 0)
    }

    @Test func aLinkWhileSignedOutIsDropped() async {
        let rig = RouterRig(credential: nil)
        await rig.model.start()
        #expect(await rig.waitForState(.signedOut(.none)))
        rig.model.handle(expenseLink)
        #expect(rig.model.captureModel.phase == .idle)
        #expect(rig.writeRequests == 0)
    }

    @Test func aHeldLinkIsDroppedWhenTheRestoreEndsSignedOut() async {
        let rig = RouterRig(credential: "refresh-0")
        let gate = Gate()
        rig.transport.route(refreshPath) { _ in await gate.wait(); return StubResponse(401, json: #"{"error":"x"}"#) }
        let starting = Task { await rig.model.start() }
        #expect(await waitUntil { rig.transport.count(refreshPath) == 1 })
        rig.model.handle(expenseLink)
        await gate.release()
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState != .restoring } })
        #expect(rig.model.sessionState != .signedIn)
        #expect(rig.model.captureModel.phase == .idle)
        await starting.value
    }
}
