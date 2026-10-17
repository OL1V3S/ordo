import Foundation
import Testing
@testable import Ordo

/// A throwaway defaults suite so a test never touches the app's real preferences.
func isolatedDefaults() -> UserDefaults {
    let name = "ordo.tests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

private func testKey(_ number: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", number) }

private final class RefreshCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var result = true
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
    func setResult(_ ok: Bool) { lock.lock(); result = ok; lock.unlock() }
    func hit() -> Bool { lock.lock(); defer { lock.unlock() }; count += 1; return result }
}

@MainActor private struct Rig {
    let model: CaptureViewModel
    let store: InMemoryPendingSaveStore
    let service: ScriptedCaptureService
    let refreshes = RefreshCounter()
    let mark: UserDefaults

    init(_ steps: [ScriptedCaptureService.Step], store: InMemoryPendingSaveStore = InMemoryPendingSaveStore(),
         mark: UserDefaults = isolatedDefaults(),
         onSend: @escaping @Sendable (PendingSave) -> Void = { _ in }) {
        self.store = store
        self.mark = mark
        service = ScriptedCaptureService(steps, onSend: onSend)
        let counter = Counter()
        let refreshes = self.refreshes
        model = CaptureViewModel(service: service, store: store, invalidationMark: mark,
                                 refreshHome: { refreshes.hit() },
                                 language: .en, deviceLocale: CaptureFixtures.english,
                                 now: { CaptureFixtures.fixedNow }, timeZone: CaptureFixtures.utc,
                                 makeKey: { testKey(counter.next()) })
    }

    func fill(_ kind: CaptureKind = .expense) {
        model.begin(kind)
        model.edit {
            $0.description = "Synthetic lunch"
            $0.amountText = "12.5"
            if kind == .expense { $0.category = .food }
        }
    }

    func submitAndSettle() async {
        model.submit()
        await model.settled()
    }
}

private let created: ScriptedCaptureService.Step = { _ in .created }
private func failing(_ error: Error) -> ScriptedCaptureService.Step { { _ in throw error } }

@MainActor @Suite struct CaptureViewModelTests {
    // MARK: Entry and defaults

    @Test func theDateDefaultsToTodayOnTheDeviceCalendar() {
        let rig = Rig([created])
        rig.model.begin(.expense)
        #expect(rig.model.draft.date.isoString == "2026-10-14")
        #expect(rig.model.draft.category == .uncategorized)
        #expect(rig.model.phase == .editing)
    }

    @Test func invalidInputShowsFieldErrorsAndSendsNothing() async {
        let rig = Rig([created])
        rig.model.begin(.expense)
        rig.model.submit()
        #expect(rig.model.phase == .editing)
        #expect(rig.model.fieldErrors == [.description, .amount])
        #expect(rig.model.focusRequest?.field == .description)
        #expect(rig.store.saves == 0)
        #expect(rig.service.sent.isEmpty)
    }

    // MARK: One key, one set of values

    @Test func aRetryAfterATimeoutSendsTheSameKeyAndValues() async {
        let attempts = Counter()
        let rig = Rig([{ _ in
            if attempts.next() == 1 { throw APIError.offline }
            return .created
        }])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .uncertain)
        #expect(rig.store.current != .none)

        rig.model.retry()
        await rig.model.settled()
        let sent = rig.service.sent
        #expect(sent.count == 2)
        #expect(sent[0] == sent[1])
        #expect(sent[0].key == testKey(1))
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.model.notice == .saved(.expense))
    }

    @Test func valuesAreLockedFromTheFirstSaveAndThePersistedRecordEqualsTheSentOne() async {
        let rig = Rig([failing(APIError.offline)])
        rig.fill()
        rig.model.submit()
        #expect(rig.model.phase == .saving)
        rig.model.edit { $0.amountText = "99" }
        rig.model.edit { $0.description = "changed" }
        await rig.model.settled()
        #expect(rig.model.phase == .uncertain)
        rig.model.edit { $0.amountText = "99" }
        #expect(rig.model.draft.amountText == "12.5")
        #expect(rig.model.draft.description == "Synthetic lunch")
        let sent = rig.service.sent
        #expect(sent.count == 1)
        #expect(rig.store.current == .record(sent[0]))
        #expect(sent[0].amount == "12.50")
        #expect(rig.model.pending == sent[0])
    }

    @Test func theRecordIsPersistedBeforeTheRequestIsSent() async {
        let store = InMemoryPendingSaveStore()
        let observed = Box<Bool>()
        let rig = Rig([created], store: store) { save in observed.value = store.current == .record(save) }
        rig.fill()
        await rig.submitAndSettle()
        #expect(observed.value == true)
    }

    @Test func aPersistenceFailureSendsNothingAndLeavesTheDraftEditable() async {
        let store = InMemoryPendingSaveStore()
        store.setFailSaves(true)
        let rig = Rig([created], store: store)
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.service.sent.isEmpty)
        #expect(rig.model.phase == .editing)
        #expect(rig.model.formError == .couldNotPrepare)
        #expect(rig.model.draft.description == "Synthetic lunch")
        store.setFailSaves(false)
        await rig.submitAndSettle()
        #expect(rig.service.sent.count == 1)
    }

    @Test func twoRapidSubmitsSendOneRequest() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .created }])
        rig.fill()
        rig.model.submit()
        rig.model.submit()
        rig.model.submit()
        #expect(await waitUntil { rig.service.sent.count == 1 })
        rig.model.retry() // not available while saving
        await gate.release()
        await rig.model.settled()
        #expect(rig.service.sent.count == 1)
        #expect(rig.store.saves == 1)
    }

    @Test func addActionsAreBlockedWhileASaveIsPending() async {
        let rig = Rig([failing(APIError.offline)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.hasPending)
        #expect(!rig.model.canBegin)
        rig.model.begin(.deposit)
        #expect(rig.model.pending?.kind == .expense)
        #expect(rig.model.phase == .uncertain)
    }

    @Test func aDepositUsesTheDepositKindAndHasNoCategory() async {
        let rig = Rig([created])
        rig.fill(.deposit)
        await rig.submitAndSettle()
        #expect(rig.service.sent.first?.kind == .deposit)
        #expect(rig.service.sent.first?.category == nil)
        #expect(rig.model.notice == .saved(.deposit))
    }

    // MARK: Results

    @Test(arguments: [CreateResult.created, CreateResult.replayed])
    func status201And200BothCountAsSavedAndRefreshHomeOnce(result: CreateResult) async {
        let rig = Rig([{ _ in result }])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .idle)
        #expect(rig.model.notice == .saved(.expense))
        #expect(rig.store.current == .none)
        #expect(rig.refreshes.value == 1)
        #expect(!rig.model.isSheetPresented)
    }

    @Test func aFailedHomeRefreshAfterASaveIsReported() async {
        let rig = Rig([created])
        rig.refreshes.setResult(false)
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.notice == .savedRefreshFailed(.expense))
        #expect(rig.model.phase == .idle)
    }

    @Test func fieldErrorsUnlockTheFormAndTheNextSaveGetsANewKey() async {
        let attempts = Counter()
        let rig = Rig([{ _ in
            if attempts.next() == 1 { throw APIError.validationFailed([.amount, .category]) }
            return .created
        }])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .editing)
        #expect(rig.model.fieldErrors == [.amount, .category])
        #expect(rig.model.focusRequest?.field == .amount)
        #expect(rig.store.current == .none)
        #expect(rig.model.pending == nil)
        rig.model.edit { $0.amountText = "20" }
        #expect(rig.model.fieldErrors == [.category])
        await rig.submitAndSettle()
        let keys = rig.service.sent.map(\.key)
        #expect(keys == [testKey(1), testKey(2)])
    }

    @Test func anUnrecognised400IsAGenericErrorAndTheFormStaysEditable() async {
        let rig = Rig([failing(APIError.createRejected)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .editing)
        #expect(rig.model.formError == .couldNotSave)
        #expect(rig.model.fieldErrors.isEmpty)
        #expect(rig.store.current == .none)
    }

    @Test func aRecordDeletedConflictSaysNothingNewWasSavedAndRefreshesHome() async {
        let rig = Rig([failing(APIError.recordDeleted)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.notice == .recordDeleted)
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.refreshes.value == 1)
    }

    @Test func aReusedKeyIsAnErrorNeverRetriedWithANewKey() async {
        let rig = Rig([failing(APIError.keyReused)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.notice == .keyReused)
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.service.sent.count == 1)
        #expect(rig.refreshes.value == 1)
    }

    @Test(arguments: [
        APIError.offline, APIError.server(500), APIError.server(503), APIError.server(418),
        APIError.server(204), APIError.invalidResponse, APIError.conflict,
    ])
    func everythingNotDefinitivelyClassifiedIsUncertain(error: APIError) async {
        let rig = Rig([failing(error)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .uncertain)
        #expect(rig.store.current == .record(rig.service.sent[0]))
        #expect(rig.refreshes.value == 0)
    }

    @Test func aCancelledRequestIsUncertain() async {
        let rig = Rig([failing(CancellationError())])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .uncertain)
    }

    @Test func a400OnARetryIsTreatedAsMaybeAlreadySaved() async {
        let attempts = Counter()
        let rig = Rig([{ _ in
            if attempts.next() == 1 { throw APIError.offline }
            throw APIError.validationFailed([.amount])
        }])
        rig.fill()
        await rig.submitAndSettle()
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.model.notice == .keyReused)
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.refreshes.value == 1)
    }

    @Test(arguments: [SessionError.signedOut as Error, APIError.sessionEnded as Error])
    func anEndedSessionClearsTheRecord(error: Error) async {
        let rig = Rig([failing(error)])
        rig.fill()
        await rig.submitAndSettle()
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.model.notice == nil)
    }

    // MARK: Discard, cancel, sign-out

    @Test func discardRemovesTheRecordAndFreesTheActions() async {
        let rig = Rig([failing(APIError.offline)])
        rig.fill()
        await rig.submitAndSettle()
        rig.model.discard()
        #expect(rig.model.phase == .idle)
        #expect(rig.store.current == .none)
        #expect(rig.model.canBegin)
    }

    @Test func discardIsNotAvailableWhileSaving() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .created }])
        rig.fill()
        rig.model.submit()
        rig.model.discard()
        #expect(rig.model.phase == .saving)
        await gate.release()
        await rig.model.settled()
        #expect(rig.model.phase == .idle)
    }

    @Test func closingTheSheetKeepsAWaitingSaveAndCancellingDropsADraft() async {
        let rig = Rig([failing(APIError.offline)])
        rig.fill()
        await rig.submitAndSettle()
        rig.model.sheetDismissed()
        #expect(!rig.model.isSheetPresented)
        #expect(rig.model.phase == .uncertain)
        #expect(rig.store.current != .none)
        rig.model.reopenSheet()
        #expect(rig.model.isSheetPresented)

        let other = Rig([created])
        other.model.begin(.deposit)
        other.model.sheetDismissed()
        #expect(other.model.phase == .idle)
        #expect(other.store.saves == 0)
    }

    @Test func signOutWarningAppliesWhileSavingOrUncertain() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); throw APIError.offline }])
        #expect(!rig.model.needsSignOutWarning)
        rig.fill()
        #expect(!rig.model.needsSignOutWarning)
        rig.model.submit()
        #expect(rig.model.needsSignOutWarning)
        await gate.release()
        await rig.model.settled()
        #expect(rig.model.needsSignOutWarning)
    }

    @Test func invalidateClearsTheRecordAndIgnoresALateResponse() async {
        let gate = Gate()
        let rig = Rig([{ _ in await gate.wait(); return .created }])
        rig.fill()
        rig.model.submit()
        #expect(await waitUntil { rig.service.sent.count == 1 })
        rig.model.invalidate()
        #expect(rig.store.current == .none)
        #expect(rig.model.phase == .idle)
        await gate.release()
        await rig.model.settled()
        #expect(rig.model.phase == .idle)
        #expect(rig.model.notice == nil) // the late "saved" result is dropped
        #expect(rig.refreshes.value == 0)
        #expect(rig.store.current == .none) // never re-persisted
    }

    // MARK: Relaunch

    @Test func aRelaunchOffersTheStoredSaveAndRetriesItWithTheSameKeyAndValues() async {
        let first = Rig([failing(APIError.offline)])
        first.fill()
        await first.submitAndSettle()
        let original = first.service.sent[0]

        let second = Rig([created], store: first.store)
        second.model.loadStoredRecord()
        #expect(second.model.phase == .idle) // not surfaced until the session is restored
        second.model.surfaceStoredRecord()
        #expect(second.model.phase == .uncertain)
        #expect(second.model.isRecovered)
        #expect(second.model.isSheetPresented)
        #expect(second.model.pending == original)
        #expect(!second.model.canBegin)

        second.model.retry()
        await second.model.settled()
        #expect(second.service.sent == [original])
        #expect(second.store.current == .none)
        #expect(second.model.notice == .saved(.expense))
    }

    @Test func aRelaunchRetryThatGets400IsNotReportedAsNotSaved() async {
        let store = InMemoryPendingSaveStore(.record(CaptureFixtures.save()))
        let rig = Rig([failing(APIError.createRejected)], store: store)
        rig.model.loadStoredRecord()
        rig.model.surfaceStoredRecord()
        rig.model.retry()
        await rig.model.settled()
        #expect(rig.model.notice == .keyReused)
        #expect(store.current == .none)
    }

    @Test func anUnreadableRecordOffersDiscardOnly() {
        let store = InMemoryPendingSaveStore(.unreadable)
        let rig = Rig([created], store: store)
        rig.model.loadStoredRecord()
        rig.model.surfaceStoredRecord()
        #expect(rig.model.phase == .unreadable)
        rig.model.retry()
        #expect(rig.model.phase == .unreadable)
        rig.model.discard()
        #expect(rig.model.phase == .idle)
        #expect(store.current == .none)
    }

    @Test func aSuppressedRecordIsNeverSurfacedOrSent() {
        let store = InMemoryPendingSaveStore(.record(CaptureFixtures.save()))
        let rig = Rig([created], store: store)
        rig.model.loadStoredRecord()
        store.setFailClears(true)
        rig.model.invalidate() // the delete fails
        #expect(store.current != .none)
        rig.model.loadStoredRecord()
        rig.model.surfaceStoredRecord()
        #expect(rig.model.phase == .idle)
        #expect(rig.service.sent.isEmpty)
    }

    @Test func aFailedDeleteIsMarkedAndTheNextLaunchRetriesItWithoutSurfacingTheRecord() {
        let mark = isolatedDefaults()
        let store = InMemoryPendingSaveStore(.record(CaptureFixtures.save()))
        let first = Rig([created], store: store, mark: mark)
        first.model.loadStoredRecord()
        store.setFailClears(true)
        first.model.invalidate() // a fresh sign-in whose delete fails
        #expect(mark.bool(forKey: CaptureViewModel.invalidationMarkKey))

        // Relaunch while the delete still fails: retried, never surfaced or sent.
        let second = Rig([created], store: store, mark: mark)
        second.model.loadStoredRecord()
        second.model.surfaceStoredRecord()
        #expect(second.model.phase == .idle)
        #expect(!second.model.hasStoredRecord)
        #expect(store.current != .none)
        #expect(mark.bool(forKey: CaptureViewModel.invalidationMarkKey)) // still set: the clear failed

        // Relaunch once the delete works: cleared, mark reset, still nothing surfaced.
        store.setFailClears(false)
        let third = Rig([created], store: store, mark: mark)
        third.model.loadStoredRecord()
        third.model.surfaceStoredRecord()
        #expect(store.current == .none)
        #expect(!mark.bool(forKey: CaptureViewModel.invalidationMarkKey))
        #expect(third.model.phase == .idle)
        #expect(third.service.sent.isEmpty)
        #expect(second.service.sent.isEmpty)
    }

    @Test func aFailedDeleteAfterADefiniteOutcomeIsNotOfferedAgainAtRelaunch() async {
        let mark = isolatedDefaults()
        let store = InMemoryPendingSaveStore()
        let first = Rig([created], store: store, mark: mark)
        first.fill()
        store.setFailClears(true)
        await first.submitAndSettle()
        #expect(first.model.notice == .saved(.expense))
        #expect(store.current != .none) // the record is still on disk
        #expect(mark.bool(forKey: CaptureViewModel.invalidationMarkKey))

        let second = Rig([created], store: store, mark: mark)
        second.model.loadStoredRecord()
        second.model.surfaceStoredRecord()
        #expect(second.model.phase == .idle)
        #expect(second.service.sent.isEmpty)
    }

    @Test func theMarkIsResetAfterASuccessfulClear() async {
        let mark = isolatedDefaults()
        mark.set(true, forKey: CaptureViewModel.invalidationMarkKey)
        let store = InMemoryPendingSaveStore(.record(CaptureFixtures.save()))
        let rig = Rig([created], store: store, mark: mark)
        rig.model.loadStoredRecord()
        #expect(store.current == .none)
        #expect(!mark.bool(forKey: CaptureViewModel.invalidationMarkKey))

        // A later successful invalidate also leaves no mark behind.
        store.setFailClears(true)
        rig.model.invalidate()
        #expect(mark.bool(forKey: CaptureViewModel.invalidationMarkKey))
        store.setFailClears(false)
        rig.model.invalidate()
        #expect(!mark.bool(forKey: CaptureViewModel.invalidationMarkKey))
    }

    @Test func aFreshSaveReplacesTheLeftoverAndResetsTheMark() async {
        let mark = isolatedDefaults()
        let store = InMemoryPendingSaveStore(.record(CaptureFixtures.save()))
        let rig = Rig([failing(APIError.offline)], store: store, mark: mark)
        store.setFailClears(true)
        rig.model.invalidate()
        #expect(mark.bool(forKey: CaptureViewModel.invalidationMarkKey))
        rig.fill()
        await rig.submitAndSettle()
        #expect(!mark.bool(forKey: CaptureViewModel.invalidationMarkKey))
        #expect(rig.model.phase == .uncertain)
    }

    @Test func signOutWarningAppliesToAnUnreadableRecordToo() {
        let store = InMemoryPendingSaveStore(.unreadable)
        let rig = Rig([created], store: store)
        rig.model.loadStoredRecord()
        rig.model.surfaceStoredRecord()
        #expect(rig.model.phase == .unreadable)
        #expect(rig.model.needsSignOutWarning)
    }

    // MARK: Through the real session and transport

    private struct Stack {
        let transport = StubTransport()
        let store = InMemoryCredentialStore()
        let manager: SessionManager
        let model: CaptureViewModel
        let pending: InMemoryPendingSaveStore

        init(pending: InMemoryPendingSaveStore = InMemoryPendingSaveStore()) async throws {
            let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
            manager = SessionManager(api: api, store: store)
            self.pending = pending
            let counter = Counter()
            model = await CaptureViewModel(service: SessionCaptureService(session: manager, api: api), store: pending,
                                           language: .en, deviceLocale: CaptureFixtures.english,
                                           now: { CaptureFixtures.fixedNow }, timeZone: CaptureFixtures.utc,
                                           makeKey: { testKey(counter.next()) })
            transport.route("/api/auth/device-sessions") { _ in
                StubResponse(200, json: #"{"token":"access-1","email":"person@example.test","refreshToken":"refresh-1"}"#)
            }
            try await manager.signIn(email: "person@example.test", password: "synthetic-password")
        }
    }

    @Test func a401RefreshesOnceAndRetriesWithTheSameKeyAndBytes() async throws {
        let stack = try await Stack()
        let calls = Counter()
        stack.transport.route("/api/expenses") { _ in calls.next() == 1 ? StubResponse(401) : StubResponse(201) }
        stack.transport.route("/api/auth/device-sessions/refresh") { _ in
            StubResponse(200, json: #"{"token":"access-2","email":"person@example.test","refreshToken":"refresh-2"}"#)
        }
        let rig = stack.model
        rig.begin(.expense)
        rig.edit { $0.description = "Synthetic lunch"; $0.amountText = "12.5"; $0.category = .food }
        rig.submit()
        await rig.settled()
        let requests = stack.transport.requests("/api/expenses")
        #expect(requests.count == 2)
        #expect(requests[0].value(forHTTPHeaderField: "Idempotency-Key") == testKey(1))
        #expect(requests[1].value(forHTTPHeaderField: "Idempotency-Key") == testKey(1))
        #expect(requests[0].httpBody == requests[1].httpBody)
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer access-2")
        #expect(stack.transport.count("/api/auth/device-sessions/refresh") == 1)
        #expect(rig.phase == .idle)
        #expect(stack.pending.current == .none)
    }

    @Test func sessionInvalidDuringASaveSignsOutAndClearsTheRecord() async throws {
        let stack = try await Stack()
        stack.transport.route("/api/inflows") { _ in StubResponse(401) }
        stack.transport.route("/api/auth/device-sessions/refresh") { _ in
            try StubResponse(401, fixture: "auth-session-invalid")
        }
        let rig = stack.model
        rig.begin(.deposit)
        rig.edit { $0.description = "Synthetic refund"; $0.amountText = "5" }
        rig.submit()
        await rig.settled()
        #expect(await stack.manager.state == .signedOut(.sessionEnded))
        #expect(rig.phase == .idle)
        #expect(stack.pending.current == .none)
        #expect(stack.transport.count("/api/inflows") == 1)
    }

    @Test func aTimeoutThenARetrySendsIdenticalBytesAndKey() async throws {
        let stack = try await Stack()
        let calls = Counter()
        stack.transport.route("/api/inflows") { _ in
            if calls.next() == 1 { throw URLError(.timedOut) }
            return StubResponse(200) // replay
        }
        let rig = stack.model
        rig.begin(.deposit)
        rig.edit { $0.description = "Synthetic refund"; $0.amountText = "5" }
        rig.submit()
        await rig.settled()
        #expect(rig.phase == .uncertain)
        rig.retry()
        await rig.settled()
        let requests = stack.transport.requests("/api/inflows")
        #expect(requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") } == [testKey(1), testKey(1)])
        #expect(requests[0].httpBody == requests[1].httpBody)
        #expect(rig.phase == .idle)
        #expect(rig.notice == .saved(.deposit)) // a 200 replay is the same record, not a duplicate
    }
}
