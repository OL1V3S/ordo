import Foundation
import Security
import Testing
@testable import Ordo

/// A synthetic JWT whose payload carries only `exp`.
func syntheticJWT(exp: Date, tag: String = "a") -> String {
    let payload = Data(#"{"exp":\#(Int(exp.timeIntervalSince1970)),"tag":"\#(tag)"}"#.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJIUzI1NiJ9.\(payload).c2ln"
}

private final class AccessBox: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [WidgetAccess?]
    private(set) var reads = 0
    /// Each read returns the next value; the last one repeats.
    init(_ values: [WidgetAccess?]) { self.values = values }
    func read() -> WidgetAccess? {
        lock.lock(); defer { lock.unlock() }
        reads += 1
        return values.count > 1 ? values.removeFirst() : values.first ?? nil
    }
}

private final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var log: [URLRequest] = []
    func append(_ request: URLRequest) { lock.lock(); log.append(request); lock.unlock() }
    var all: [URLRequest] { lock.lock(); defer { lock.unlock() }; return log }
}

private let now = ReportsFixtures.now
private let base = URL(string: "https://api.example.test")!

private func access(_ tag: String = "a", savedAgo: TimeInterval = 60, expIn: TimeInterval = 3600) -> WidgetAccess {
    WidgetAccess(accessToken: syntheticJWT(exp: now.addingTimeInterval(expIn), tag: tag), savedAt: now.addingTimeInterval(-savedAgo))
}

private func sixMonths(currentSpent: String = "10000") -> String {
    let keys = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
    var list = keys.map { ReportsFixtures.monthJSON($0, to: "\($0)-28", spent: "5000") }
    list.append(ReportsFixtures.monthJSON("2026-10", to: "2026-10-20", spent: currentSpent))
    return ReportsFixtures.json(selected: ReportsFixtures.monthJSON("2026-10", to: "2026-10-20", spent: currentSpent),
                                months: list)
}

private func loader(_ box: AccessBox, log: RequestLog = RequestLog(), baseURL: URL? = base, language: AppLanguage = .en,
                    respond: @escaping @Sendable (Int) throws -> (Data, Int)) -> WidgetSpendingLoader {
    let counter = RequestLog()
    return WidgetSpendingLoader(baseURL: baseURL, readAccess: { box.read() }, send: { request in
        log.append(request)
        counter.append(request)
        return try respond(counter.all.count)
    }, language: language, timeZone: ReportsFixtures.utc)
}

@Suite struct WidgetSpendingMappingTests {
    @Test func showsTheLastSixMonthsWithTheCurrentOneMarked() throws {
        let report = try CashFlowValidation.parse(Data(sixMonths().utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .en, fetchedAt: now))
        #expect(spending.bars.map(\.month.key) == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
        #expect(spending.bars.map(\.isCurrent) == [false, false, false, false, false, true])
        #expect(spending.currentSpentText == "$100.00")
        #expect(spending.bars.last?.fraction == 1)
        #expect(spending.bars.first?.fraction == 0.5)
        #expect(!spending.isEmpty)
    }

    @Test func exactTextAboveTwoToThe53() throws {
        let big = "123456789012345678901"
        let report = try CashFlowValidation.parse(Data(sixMonths(currentSpent: big).utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .en, fetchedAt: now))
        #expect(spending.currentSpentText == "$1,234,567,890,123,456,789.01")
        #expect(spending.bars.last?.spentText == "$1,234,567,890,123,456,789.01")
    }

    @Test func spanishUsesMexicanFormatting() throws {
        let report = try CashFlowValidation.parse(Data(sixMonths(currentSpent: "123456").utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .es, fetchedAt: now))
        #expect(spending.currentSpentText == ReportsFormatter(language: .es).cash(CashAmount(123456)))
        #expect(spending.currentSpentText.contains("1,234.56"))
        #expect(WidgetSpending.shortMonthName(ReportsFixtures.october, language: .es).lowercased().hasPrefix("oct"))
        #expect(spending.updatedText(at: now.addingTimeInterval(15 * 60)).contains("15"))
    }

    @Test func zeroSpendingIsEmptyButStillExact() throws {
        let report = try CashFlowValidation.parse(Data(sixMonths(currentSpent: "0").utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .en, fetchedAt: now))
        #expect(spending.isEmpty)
        #expect(spending.currentSpentText == "$0.00")
    }

    @Test func repeatedMonthsOrAMissingCurrentMonthFail() throws {
        let repeated = ReportsFixtures.json(months: [ReportsFixtures.monthJSON("2026-10", to: "2026-10-20"),
                                                     ReportsFixtures.monthJSON("2026-10", to: "2026-10-20")])
        let report = try CashFlowValidation.parse(Data(repeated.utf8), month: ReportsFixtures.october, throughDate: ReportsFixtures.through)
        #expect(WidgetSpending.map(report, language: .en, fetchedAt: now) == nil)
        let missing = ReportsFixtures.json(months: [ReportsFixtures.monthJSON("2026-09", to: "2026-09-30")])
        let other = try CashFlowValidation.parse(Data(missing.utf8), month: ReportsFixtures.october, throughDate: ReportsFixtures.through)
        #expect(WidgetSpending.map(other, language: .en, fetchedAt: now) == nil)
    }

    @Test func aMonthToDateFigureIsNotCurrentInTheNextMonth() throws {
        let report = try CashFlowValidation.parse(Data(sixMonths().utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .en, fetchedAt: now))
        #expect(spending.isCurrent(at: now, timeZone: ReportsFixtures.utc))
        let novemberFirst = Date(timeIntervalSince1970: 1_793_491_200) // 2026-11-01 00:00 UTC
        #expect(!spending.isCurrent(at: novemberFirst, timeZone: ReportsFixtures.utc))
    }

    @Test func descriptionsAreRedacted() throws {
        let report = try CashFlowValidation.parse(Data(sixMonths().utf8), month: ReportsFixtures.october,
                                                  throughDate: ReportsFixtures.through)
        let spending = try #require(WidgetSpending.map(report, language: .en, fetchedAt: now))
        #expect(!String(describing: spending).contains("100"))
        #expect(!String(describing: access()).contains("eyJ"))
    }
}

@Suite struct WidgetAccessFreshnessTests {
    @Test func freshTokenIsUsable() { #expect(access().isUsable(now: now)) }
    @Test func olderThanTwoHoursIsNot() { #expect(!access(savedAgo: 2 * 3600 + 1, expIn: 3600).isUsable(now: now)) }
    @Test func expiredIsNot() { #expect(!access(expIn: -1).isUsable(now: now)) }
    @Test func savedInTheFutureIsNot() { #expect(!access(savedAgo: -3600).isUsable(now: now)) }
    @Test func unreadableTokenIsNot() {
        #expect(!WidgetAccess(accessToken: "not-a-jwt", savedAt: now).isUsable(now: now))
        #expect(!WidgetAccess(accessToken: "", savedAt: now).isUsable(now: now))
    }
}

@Suite struct WidgetSpendingLoaderTests {
    @Test func loadsWithTheExistingCashFlowRequest() async throws {
        let log = RequestLog()
        let token = access()
        let state = await loader(AccessBox([token]), log: log) { _ in (Data(sixMonths().utf8), 200) }.load(now: now)
        guard case .loaded(let spending) = state else { Issue.record("not loaded"); return }
        #expect(spending.currentSpentText == "$100.00")
        let request = try #require(log.all.first)
        #expect(log.all.count == 1)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://api.example.test/api/analytics/cash-flow?month=2026-10&throughDate=2026-10-20")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token.accessToken)")
    }

    @Test func notConfiguredWithoutAServer() async {
        let log = RequestLog()
        #expect(await loader(AccessBox([access()]), log: log, baseURL: nil) { _ in (Data(), 200) }.load(now: now) == .notConfigured)
        #expect(log.all.isEmpty)
    }

    @Test func signedOutWithoutAnItem() async {
        let log = RequestLog()
        #expect(await loader(AccessBox([nil]), log: log) { _ in (Data(), 200) }.load(now: now) == .signedOut)
        #expect(log.all.isEmpty)
    }

    @Test(arguments: [7201.0, -1.0])
    func staleOrExpiredSkipsTheNetwork(value: Double) async {
        let log = RequestLog()
        let item = value > 0 ? access(savedAgo: value) : access(expIn: value)
        #expect(await loader(AccessBox([item]), log: log) { _ in (Data(), 200) }.load(now: now) == .needsUpdate)
        #expect(log.all.isEmpty)
    }

    @Test func unauthorizedAsksToOpenOrdo() async {
        #expect(await loader(AccessBox([access()])) { _ in (Data(), 401) }.load(now: now) == .needsUpdate)
    }

    @Test func offlineServerErrorMalformedAndWrongPeriodAreUnavailable() async {
        #expect(await loader(AccessBox([access()])) { _ in throw URLError(.notConnectedToInternet) }.load(now: now) == .unavailable)
        #expect(await loader(AccessBox([access()])) { _ in (Data(), 503) }.load(now: now) == .unavailable)
        #expect(await loader(AccessBox([access()])) { _ in (Data(#"{"month":"2026-10"}"#.utf8), 200) }.load(now: now) == .unavailable)
        let september = ReportsFixtures.json(month: "2026-09", through: "2026-10-20")
        #expect(await loader(AccessBox([access()])) { _ in (Data(september.utf8), 200) }.load(now: now) == .unavailable)
    }

    @Test func signedOutDuringTheRequestDropsTheResult() async {
        let state = await loader(AccessBox([access(), nil])) { _ in (Data(sixMonths().utf8), 200) }.load(now: now)
        #expect(state == .signedOut)
    }

    @Test func aChangedTokenRefetchesOnce() async {
        let log = RequestLog()
        let first = access("a"), second = access("b")
        let state = await loader(AccessBox([first, second, second, second]), log: log) { _ in (Data(sixMonths().utf8), 200) }
            .load(now: now)
        guard case .loaded = state else { Issue.record("not loaded"); return }
        #expect(log.all.count == 2)
        #expect(log.all.last?.value(forHTTPHeaderField: "Authorization") == "Bearer \(second.accessToken)")
    }

    @Test func aTokenThatKeepsChangingGivesUp() async {
        let log = RequestLog()
        let box = AccessBox([access("a"), access("b"), access("c"), access("d")])
        #expect(await loader(box, log: log) { _ in (Data(sixMonths().utf8), 200) }.load(now: now) == .needsUpdate)
        #expect(log.all.count == 2)
    }
}

// MARK: SessionManager and the widget item

final class SpyWidgetAccessStore: WidgetAccessStore, @unchecked Sendable {
    enum Event: Equatable { case save(String), delete, overwriteEmpty, reload }
    private let lock = NSLock()
    private var log: [Event] = []
    private var failSave = false, failDelete = false

    init(failSave: Bool = false, failDelete: Bool = false) { self.failSave = failSave; self.failDelete = failDelete }
    var events: [Event] { lock.lock(); defer { lock.unlock() }; return log }
    var savedTokens: [String] { events.compactMap { if case .save(let token) = $0 { token } else { nil } } }

    func save(_ access: WidgetAccess) throws {
        lock.lock(); defer { lock.unlock() }
        if failSave { throw KeychainError.unexpectedStatus(-25300) }
        log.append(.save(access.accessToken))
    }
    func delete() throws {
        lock.lock(); defer { lock.unlock() }
        if failDelete { throw KeychainError.unexpectedStatus(-25300) }
        log.append(.delete)
    }
    func overwriteWithEmpty() throws { lock.lock(); log.append(.overwriteEmpty); lock.unlock() }
    func reloadWidget() { lock.lock(); log.append(.reload); lock.unlock() }
}

private struct WidgetHarness {
    let transport = StubTransport()
    let store: InMemoryCredentialStore
    let widget: SpyWidgetAccessStore
    let manager: SessionManager

    init(stored: String? = nil, widget: SpyWidgetAccessStore = SpyWidgetAccessStore()) {
        store = InMemoryCredentialStore(initial: stored)
        self.widget = widget
        manager = SessionManager(api: OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport),
                                 store: store, widgetAccess: widget, now: { now })
        transport.route("/api/auth/device-sessions/sign-out") { _ in StubResponse(204, Data()) }
    }

    static func session(_ access: String, _ refresh: String) -> StubResponse {
        StubResponse(200, json: #"{"token":"\#(access)","email":"person@example.test","refreshToken":"\#(refresh)"}"#)
    }

    func signIn() async throws {
        transport.route("/api/auth/device-sessions") { _ in Self.session("access-1", "refresh-1") }
        try await manager.signIn(email: "person@example.test", password: "synthetic-password")
    }
}

@Suite struct SessionManagerWidgetAccessTests {
    @Test func signInWritesOnlyTheAccessToken() async throws {
        let h = WidgetHarness()
        try await h.signIn()
        #expect(h.widget.events == [.save("access-1"), .reload])
        #expect(h.store.value == "refresh-1")
    }

    @Test func refreshWritesTheNewAccessTokenAndNeverACredential() async throws {
        let h = WidgetHarness(stored: "refresh-0")
        h.transport.route("/api/auth/device-sessions/refresh") { _ in WidgetHarness.session("access-2", "refresh-2") }
        await h.manager.restore()
        #expect(h.widget.savedTokens == ["access-2"])
        #expect(h.widget.savedTokens.allSatisfy { !$0.hasPrefix("refresh") })
    }

    @Test func signOutDeletesTheItemAndReloads() async throws {
        let h = WidgetHarness()
        try await h.signIn()
        await h.manager.signOut()
        #expect(Array(h.widget.events.suffix(2)) == [.delete, .reload])
    }

    @Test func aSessionEndDeletesTheItem() async throws {
        let h = WidgetHarness(stored: "refresh-0")
        h.transport.route("/api/auth/device-sessions/refresh") { _ in
            StubResponse(401, json: #"{"code":"session_invalid"}"#)
        }
        await h.manager.restore()
        #expect(await h.manager.state == .signedOut(.sessionEnded))
        #expect(h.widget.events == [.delete, .reload])
    }

    @Test func aFailedDeleteOverwritesWithEmpty() async throws {
        let h = WidgetHarness(widget: SpyWidgetAccessStore(failDelete: true))
        try await h.signIn()
        await h.manager.signOut()
        #expect(Array(h.widget.events.suffix(2)) == [.overwriteEmpty, .reload])
    }

    @Test func aFailedWriteIsNotFatal() async throws {
        let h = WidgetHarness(widget: SpyWidgetAccessStore(failSave: true))
        try await h.signIn()
        #expect(await h.manager.state == .signedIn)
        #expect(try await h.manager.authorized { $0.value } == "access-1")
    }

    @Test func freshInstallDeletesTheItemToo() {
        let defaults = UserDefaults(suiteName: "ordo.tests.\(UUID().uuidString)")!
        let widget = SpyWidgetAccessStore()
        FreshInstallGuard.apply(defaults: defaults, store: InMemoryCredentialStore(initial: "leftover"), widgetAccess: widget)
        #expect(widget.events == [.delete])
        FreshInstallGuard.apply(defaults: defaults, store: InMemoryCredentialStore(), widgetAccess: widget)
        #expect(widget.events == [.delete])
        let failing = SpyWidgetAccessStore(failDelete: true)
        FreshInstallGuard.apply(defaults: UserDefaults(suiteName: "ordo.tests.\(UUID().uuidString)")!,
                                store: InMemoryCredentialStore(), widgetAccess: failing)
        #expect(failing.events == [.overwriteEmpty])
    }
}

// MARK: Real simulator Keychain

@Suite(.serialized) struct WidgetKeychainTests {
    private static func group(_ key: String) throws -> String {
        try #require(Bundle.main.object(forInfoDictionaryKey: key) as? String)
    }

    private static func accessGroup(service: String, account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account,
                                    kSecReturnAttributes as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return (result as? [String: Any])?[kSecAttrAccessGroup as String] as? String
    }

    @Test func groupsComeFromTheBuildSettings() throws {
        let shared = try Self.group(WidgetAccessLocation.sharedGroupKey)
        let privateGroup = try Self.group(KeychainCredentialStore.privateGroupKey)
        #expect(shared.hasSuffix(".ordo.shared"))
        #expect(!shared.contains("$("))
        #expect(privateGroup != shared)
        #expect(WidgetAccessLocation.load()?.accessGroup == shared)
        #expect(WidgetAccessLocation.load()?.service.hasSuffix(".ordo.widget") == true)
        #expect(KeychainCredentialStore().addAccessGroup == privateGroup)
    }

    @Test func widgetItemRoundTripInTheSharedGroup() throws {
        let shared = try Self.group(WidgetAccessLocation.sharedGroupKey)
        let location = WidgetAccessLocation(service: "ordo.tests.\(UUID().uuidString)", accessGroup: shared)
        let store = KeychainWidgetAccessStore(location: location)
        let reader = WidgetAccessReader(location: location)
        defer { try? store.delete() }
        #expect(reader.read() == nil)
        let item = WidgetAccess(accessToken: syntheticJWT(exp: now), savedAt: now)
        try store.save(item)
        #expect(reader.read() == item)
        #expect(Self.accessGroup(service: location.service, account: WidgetAccessLocation.account) == shared)
        try store.overwriteWithEmpty()
        #expect(reader.read() == nil)
        try store.delete()
        #expect(reader.read() == nil)
        try store.delete()
    }

    @Test func theCredentialIsAddedToThePrivateGroupOnly() throws {
        let privateGroup = try Self.group(KeychainCredentialStore.privateGroupKey)
        let shared = try Self.group(WidgetAccessLocation.sharedGroupKey)
        let store = KeychainCredentialStore(service: "ordo.tests.\(UUID().uuidString)", addAccessGroup: privateGroup)
        defer { try? store.delete() }
        try store.save("synthetic-1")
        try store.save("synthetic-2")
        #expect(try store.read() == "synthetic-2")
        let group = Self.accessGroup(service: store.service, account: KeychainCredentialStore.account)
        #expect(group == privateGroup)
        #expect(group != shared)
        // The widget's reader, pointed at the credential's service in the shared group, finds nothing.
        let probe = WidgetAccessReader(location: WidgetAccessLocation(service: store.service, accessGroup: shared))
        #expect(probe.read() == nil)
    }
}

// MARK: Widget localization

@Suite struct WidgetLocalizationTests {
    private static let expectedKeys: Set<String> = [
        "widget.addDeposit", "widget.addExpense", "widget.description", "widget.empty", "widget.monthToDate",
        "widget.name", "widget.needsUpdate", "widget.notConfigured", "widget.signedOut", "widget.spentThisMonth",
        "widget.summary %@ %@", "widget.unavailable", "widget.updated %@",
    ]

    @Test func everyWidgetKeyHasEnglishAndSpanish() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "OrdoWidget/Localizable.xcstrings")
        let json = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let strings = try #require(json["strings"] as? [String: Any])
        #expect(Set(strings.keys) == Self.expectedKeys)
        for (key, value) in strings {
            let localizations = (value as? [String: Any])?["localizations"] as? [String: Any]
            for language in ["en", "es"] {
                let unit = (localizations?[language] as? [String: Any])?["stringUnit"] as? [String: Any]
                #expect(unit?["state"] as? String == "translated", "\(key) \(language)")
                #expect((unit?["value"] as? String)?.isEmpty == false, "\(key) \(language)")
                if language == "es" { #expect((unit?["value"] as? String)?.lowercased().contains("usted") == false) }
            }
        }
    }
}
