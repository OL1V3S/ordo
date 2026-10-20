import Foundation
import Testing
@testable import Ordo

@MainActor private struct ImportRig {
    let transport = StubTransport()
    let manager: SessionManager
    let model: AppModel

    init() {
        let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
        manager = SessionManager(api: api, store: InMemoryCredentialStore(initial: nil))
        model = AppModel(session: manager, api: api, pendingStore: InMemoryPendingSaveStore(),
                         invalidationMark: isolatedDefaults(), language: .en, deviceLocale: TimelineFixtures.english)
        let b = ImportFixtures.batch
        transport.route("/api/auth/device-sessions/sign-out") { _ in StubResponse(204, Data()) }
        transport.route("/api/home") { _ in try StubResponse(200, fixture: "home-all-available") }
        transport.route("/api/auth/device-sessions") { _ in
            StubResponse(200, json: #"{"token":"access-1","email":"person@example.test","refreshToken":"refresh-1"}"#)
        }
        transport.route("/api/activity/timeline") { _ in try StubResponse(200, fixture: "timeline-first-page") }
        transport.route("/api/import-previews/open") { _ in StubResponse(200, json: ImportFixtures.previewJSON([ImportFixtures.rowJSON(ImportFixtures.row1, selected: true)])) }
        transport.route("/api/import-previews/\(b)/confirm") { _ in StubResponse(200, json: ImportFixtures.confirmationJSON()) }
        transport.route("/api/import-previews/\(b)/rows/\(ImportFixtures.row1)") { _ in StubResponse(200, json: ImportFixtures.rowJSON(ImportFixtures.row1)) }
    }

    static func signedIn() async throws -> ImportRig {
        let rig = ImportRig()
        await rig.model.start()
        _ = await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } }
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedIn } })
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        return rig
    }
}

@MainActor @Suite struct AppModelImportTests {
    @Test func aConfirmedImportReadsHomeAndOpenedTabsAgainOnce() async throws {
        let rig = try await ImportRig.signedIn()
        await rig.model.transactionsModel.loadIfNeeded()
        let timeline = rig.transport.count("/api/activity/timeline")
        await rig.model.importModel.open()
        rig.model.importModel.confirm()
        await rig.model.importModel.settled()
        #expect(rig.model.importModel.phase == .completed)
        #expect(rig.transport.count("/api/home") == 2 && rig.transport.count("/api/activity/timeline") == timeline + 1)
    }

    @Test func anUnknownConfirmThenCloseStillRefreshesOtherTabs() async throws {
        let rig = try await ImportRig.signedIn()
        rig.transport.route("/api/import-previews/\(ImportFixtures.batch)/confirm") { _ in StubResponse(503, Data()) }
        await rig.model.importModel.open()
        rig.model.importModel.confirm()
        await rig.model.importModel.settled()
        #expect(rig.transport.count("/api/home") == 1)
        await rig.model.importModel.close()
        #expect(rig.transport.count("/api/home") == 2)
    }

    @Test func importIsPartOfTheOneWriteAtATimeGate() async throws {
        let rig = try await ImportRig.signedIn()
        let gate = Gate()
        rig.transport.route("/api/import-previews/\(ImportFixtures.batch)/confirm") { _ in
            await gate.wait(); return StubResponse(200, json: ImportFixtures.confirmationJSON())
        }
        await rig.model.importModel.open()
        rig.model.importModel.confirm()
        #expect(await waitUntil { await MainActor.run { rig.model.isWriteInFlight } })
        // Other models see the import write and refuse to start.
        #expect(rig.model.mutationModel.isSubmitting == false)
        await gate.release()
        await rig.model.importModel.settled()
        #expect(!rig.model.isWriteInFlight)
    }

    @Test func anOtherWriteBlocksImportEditsAndSignOutResetsImport() async throws {
        let rig = try await ImportRig.signedIn()
        await rig.model.importModel.open()
        #expect(rig.model.importModel.canEdit)
        rig.model.captureModel.begin(.expense)
        rig.model.captureModel.edit { $0.description = "Synthetic"; $0.amountText = "5.00" }
        let gate = Gate()
        rig.transport.route("/api/expenses") { _ in await gate.wait(); return StubResponse(201, json: "{}") }
        rig.model.captureModel.submit()
        #expect(await waitUntil { await MainActor.run { rig.model.captureModel.phase == .saving } })
        #expect(!rig.model.importModel.canEdit)
        await gate.release()
        await rig.model.captureModel.settled()
        #expect(rig.model.importModel.canEdit)
        await rig.model.signOut()
        #expect(rig.model.importModel.phase == .idle && rig.model.importModel.preview == nil)
    }

    @Test func aSessionChangeResetsImport() async throws {
        let rig = try await ImportRig.signedIn()
        await rig.model.importModel.open()
        #expect(rig.model.importModel.phase == .review)
        await rig.manager.signOut()
        #expect(await waitUntil { await MainActor.run { rig.model.importModel.phase == .idle } })
    }
}
