import Foundation
import Testing
@testable import Ordo

private func session(_ access: String, _ refresh: String) -> StubResponse {
    StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
}

@MainActor private struct PaycheckRig {
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
        transport.route("/api/inflows") { _ in StubResponse(201, json: "{}") }
    }

    static func signedIn() async throws -> PaycheckRig {
        let rig = PaycheckRig()
        await rig.model.start()
        _ = await waitUntil { await MainActor.run { rig.model.sessionState == .signedOut(.none) } }
        try await rig.manager.signIn(email: "person@example.test", password: "synthetic-password")
        #expect(await waitUntil { await MainActor.run { rig.model.sessionState == .signedIn } })
        #expect(await waitUntil { rig.transport.count("/api/home") == 1 })
        return rig
    }
}

@MainActor @Suite struct AppModelPaychecksTests {
    @Test func anUnopenedTabIsNotReadByOtherScreensWrites() async throws {
        let rig = try await PaycheckRig.signedIn()
        await rig.model.paychecksModel.refreshIfLoaded()
        #expect(rig.transport.count("/api/paychecks") == 0)
    }

    @Test func aDepositSavedFromCaptureRefreshesPaychecksOnceOpened() async throws {
        let rig = try await PaycheckRig.signedIn()
        await rig.model.paychecksModel.loadIfNeeded()
        #expect(rig.transport.count("/api/paychecks") == 1)
        rig.model.captureModel.begin(.deposit)
        rig.model.captureModel.edit { $0.description = "Synthetic"; $0.amountText = "5.00" }
        rig.model.captureModel.submit()
        await rig.model.captureModel.settled()
        #expect(await waitUntil { rig.transport.count("/api/paychecks") == 2 })
    }

    @Test func aTransactionsDepositChangeRefreshesPaychecksOnceOpened() async throws {
        let rig = try await PaycheckRig.signedIn()
        rig.transport.route("/api/inflows/5") { _ in StubResponse(204, Data()) }
        await rig.model.paychecksModel.loadIfNeeded()
        let item = TimelineFixtures.item(.accountInflow, id: 5, date: "2026-10-02", amount: .exact(Money.parse("10.00")!))
        rig.model.mutationModel.beginDelete(item)
        rig.model.mutationModel.confirmDelete(item)
        await rig.model.mutationModel.settled()
        #expect(await waitUntil { rig.transport.count("/api/paychecks") == 2 })
    }

    @Test func oneWriteInFlightAppWideInBothDirections() async throws {
        let rig = try await PaycheckRig.signedIn()
        await rig.model.paychecksModel.loadIfNeeded()
        let gate = Gate()
        rig.transport.route("/api/paychecks/\(PaycheckFixtures.id1)/lifecycle") { _ in await gate.wait(); return StubResponse(200, json: "{}") }
        let profile = try #require(rig.model.paychecksModel.snapshot?.profiles.first)
        rig.model.paychecksModel.perform(.pause, on: profile)
        #expect(rig.model.isWriteInFlight)
        #expect(!rig.model.mutationModel.canStart && !rig.model.budgetsModel.canAdd)
        await gate.release()
        await rig.model.paychecksModel.settled()
        #expect(!rig.model.isWriteInFlight)
        // ... and a transaction edit in flight blocks a paycheck write.
        let item = TimelineFixtures.item(.accountInflow, id: 5, date: "2026-10-02", amount: .exact(Money.parse("10.00")!))
        let hold = Gate()
        rig.transport.route("/api/inflows/5") { _ in await hold.wait(); return StubResponse(204, Data()) }
        rig.model.mutationModel.beginDelete(item)
        rig.model.mutationModel.confirmDelete(item)
        rig.model.paychecksModel.perform(.pause, on: profile)
        #expect(rig.transport.count("/api/paychecks/\(PaycheckFixtures.id1)/lifecycle") == 1)
        await hold.release()
        await rig.model.mutationModel.settled()
    }

    @Test func signOutResetsPaychecks() async throws {
        let rig = try await PaycheckRig.signedIn()
        await rig.model.paychecksModel.loadIfNeeded()
        #expect(rig.model.paychecksModel.snapshot != nil)
        await rig.model.signOut()
        #expect(rig.model.paychecksModel.snapshot == nil && rig.model.paychecksModel.listState == .idle)
    }
}

@Suite struct PaychecksPresentationTests {
    private func presenter(_ language: AppLanguage) -> PaychecksPresenter { PaychecksPresenter(l10n: L10n(language: language)) }

    @Test func scheduleFormatting() {
        let en = presenter(.en)
        let biweekly = PaycheckSchedule(cadence: .biweekly, reference: PaycheckFixtures.date("2026-10-16"), first: nil, second: nil)
        #expect(en.schedule(biweekly) == "Every two weeks, starting Oct 16, 2026")
        let semi = PaycheckSchedule(cadence: .semimonthly, reference: nil, first: .day(1), second: .monthEnd)
        #expect(en.schedule(semi) == "Twice a month, day 1 and month end")
        #expect(en.schedule(PaycheckSchedule(cadence: .monthly, reference: nil, first: .day(15), second: nil)) == "Monthly, day 15")
        #expect(en.schedule(nil) == "Pay dates unavailable")
        #expect(presenter(.es).schedule(semi).contains("fin de mes"))
    }

    @Test func windowPluralsInBothLanguages() {
        #expect(presenter(.en).window(before: 1, after: 2) == "1 day before · 2 days after")
        #expect(presenter(.en).window(before: 0, after: 1) == "0 days before · 1 day after")
        #expect(presenter(.es).window(before: 1, after: 3) == "1 día antes · 3 días después")
    }

    @Test func amountsAreExactAndRangesUseADash() {
        let en = presenter(.en)
        #expect(en.amount(.fixed(.exact(Money.parse("1200.25")!))) == "$1,200.25")
        #expect(en.amount(.range(minimum: .exact(Money.parse("100.00")!), maximum: .exact(Money.parse("250.50")!))) == "$100.00 – $250.50")
        #expect(en.amount(.fixed(.needsReview)) == "Exact amount unavailable")
        #expect(en.amount(.unavailable) == "Amount unavailable")
        #expect(presenter(.es).amount(.fixed(.exact(Money.parse("1200.25")!))).hasPrefix("USD"))
    }

    @Test func nextWindowIsExpectedNotReceived() {
        let en = presenter(.en)
        var profile = PaycheckFixtures.profile()
        #expect(en.nextWindow(profile) == "No expected dates available. Expected, not guaranteed.")
        profile = PaycheckFixtures.profile(lifecycle: .paused)
        #expect(en.nextWindow(profile) == "Paused pay schedules have no expected dates.")
        #expect(en.l10n.string(.paychecksCardNotGuaranteed) == "Expected, not guaranteed.")
    }

    @Test func everyServerCodeHasItsOwnMessage() {
        let codes = ["authentication_required", "paycheck_not_found", "lifecycle_invalid", "schedule_invalid", "paycheck_not_active",
                     "receipt_slot_invalid", "receipt_slot_unavailable", "receipt_source_invalid", "receipt_inflow_invalid",
                     "receipt_inflow_unavailable", "receipt_conflict", "receipt_link_protected", "receipt_date_invalid", "request_invalid"]
        #expect(Set(codes.map { PaychecksPresenter.errorKey($0) }).count == codes.count)
        #expect(PaychecksPresenter.errorKey("surprise") == .paychecksFeedbackErrorsRequestFailed)
        #expect(PaychecksPresenter.errorKey(nil) == .paychecksFeedbackErrorsRequestFailed)
    }

    @Test func redactedTypesPrintNothingPrivate() {
        let profile = PaycheckFixtures.profile(evidence: [PaycheckFixtures.evidence(5)])
        let text = "\(profile) \(profile.evidence[0]) \(PaycheckFixtures.deposit(1, "Secret deposit")) \(ReceiptDraft.initial(for: profile, today: PaycheckFixtures.date("2026-10-20")))"
        #expect(!text.contains("Synthetic") && !text.contains("Secret") && !text.contains("1200"))
        #expect(!"\(PaycheckWrite(operation: .removeReceipt(id: PaycheckFixtures.id1, inflowId: 5)))".contains(PaycheckFixtures.id1))
    }
}
