import Foundation
import Testing
@testable import Ordo

private let timelinePath = "/api/activity/timeline"

private struct TimelineHarness {
    let transport = StubTransport()
    let api: OrdoAPI
    init() { api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport) }

    func read(_ query: TimelineQuery = TimelineQuery()) async throws -> Data {
        try await api.activityTimeline(accessToken: "access-1", query: query)
    }

    /// The raw, percent-encoded query string of the last request.
    func lastQuery() throws -> String {
        let request = try #require(transport.requests(timelinePath).last)
        return try #require(request.url?.query(percentEncoded: true))
    }
}

@Suite struct TimelineAPITests {
    @Test func anUnfilteredReadSendsOnlyTheLimit() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        _ = try await h.read()
        #expect(try h.lastQuery() == "limit=25")
    }

    @Test func theRequestIsAnAuthorizedGet() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        _ = try await h.read()
        let request = try #require(h.transport.requests(timelinePath).first)
        #expect(request.httpMethod == "GET")
        #expect(request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func onlySetFiltersAreSentInAFixedOrder() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        var filter = TimelineFilter()
        filter.to = CalendarDate("2026-10-31")
        filter.q = "lunch"
        filter.kind = .accountInflow
        filter.from = CalendarDate("2026-10-01")
        _ = try await h.read(TimelineQuery(cursor: "abc_DEF-1", filter: filter))
        #expect(try h.lastQuery() == "limit=25&cursor=abc_DEF-1&q=lunch&kind=account_inflow&from=2026-10-01&to=2026-10-31")
    }

    @Test(arguments: [
        (TimelineKindFilter.expense, "limit=25&kind=expense"),
        (TimelineKindFilter.accountInflow, "limit=25&kind=account_inflow"),
        (TimelineKindFilter.all, "limit=25"),
    ])
    func theKindIsSentOnlyWhenSet(kind: TimelineKindFilter, expected: String) async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        var filter = TimelineFilter()
        filter.kind = kind
        _ = try await h.read(TimelineQuery(filter: filter))
        #expect(try h.lastQuery() == expected)
    }

    @Test func theSearchIsTrimmedAndAWhitespaceOnlySearchIsNotSent() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        var filter = TimelineFilter()
        filter.q = "  lunch \n"
        _ = try await h.read(TimelineQuery(filter: filter))
        #expect(try h.lastQuery() == "limit=25&q=lunch")
        filter.q = " \t "
        _ = try await h.read(TimelineQuery(filter: filter))
        #expect(try h.lastQuery() == "limit=25")
    }

    @Test func reservedCharactersAreEncodedSoPlusIsNeverReadAsASpace() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        var filter = TimelineFilter()
        filter.q = "a+b&c=d é/?#%"
        _ = try await h.read(TimelineQuery(filter: filter))
        #expect(try h.lastQuery() == "limit=25&q=a%2Bb%26c%3Dd%20%C3%A9%2F%3F%23%25")
        // A real URL parser reads the same text back.
        let request = try #require(h.transport.requests(timelinePath).last)
        let url = try #require(request.url)
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.queryItems?.first { $0.name == "q" }?.value == "a+b&c=d é/?#%")
    }

    @Test func theOwnerIsNeverAParameter() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        var filter = TimelineFilter()
        filter.q = "x"
        _ = try await h.read(TimelineQuery(cursor: "c", filter: filter))
        let query = try h.lastQuery().lowercased()
        for name in ["owner", "user", "email", "account"] { #expect(!query.contains(name)) }
    }

    @Test func theCursorIsSentUnchangedOnlyOnLoadMore() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(200) }
        _ = try await h.read(TimelineQuery())
        #expect(try !h.lastQuery().contains("cursor"))
        _ = try await h.read(TimelineQuery(cursor: "c3ludGhldGljLWN1cnNvcg"))
        #expect(try h.lastQuery() == "limit=25&cursor=c3ludGhldGljLWN1cnNvcg")
        _ = try await h.read(TimelineQuery(cursor: ""))
        #expect(try !h.lastQuery().contains("cursor"))
    }

    @Test func aSuccessfulReadReturnsTheRawBody() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in try StubResponse(200, fixture: "timeline-first-page") }
        let data = try await h.read()
        #expect(try TimelineValidation.parse(data).items.count == 3)
    }

    // MARK: Statuses

    @Test(arguments: [
        ("activity_timeline_limit_invalid", TimelineRejection.limit),
        ("activity_timeline_cursor_invalid", .cursor),
        ("activity_timeline_search_invalid", .search),
        ("activity_timeline_kind_invalid", .kind),
        ("activity_timeline_date_invalid", .date),
        ("something_new", .other),
    ])
    func eachBadRequestCodeMapsToARejection(code: String, expected: TimelineRejection) async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(400, json: #"{"code":"\#(code)","title":"synthetic server text"}"#) }
        await #expect(throws: APIError.timelineRejected(expected)) { try await h.read() }
    }

    @Test func aBadRequestWithoutACodeIsOther() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(400, json: #""just text""#) }
        await #expect(throws: APIError.timelineRejected(.other)) { try await h.read() }
    }

    @Test func theFilterFixtureMapsToTheSearchRejection() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in try StubResponse(400, fixture: "timeline-filter-400") }
        await #expect(throws: APIError.timelineRejected(.search)) { try await h.read() }
        #expect(TimelineRejection.search.isFilter && TimelineRejection.date.isFilter && TimelineRejection.kind.isFilter)
        #expect(!TimelineRejection.cursor.isFilter && !TimelineRejection.limit.isFilter && !TimelineRejection.other.isFilter)
    }

    @Test func theUnavailableCodeMapsToUnavailable() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(503, json: #"{"code":"activity_timeline_unavailable"}"#) }
        await #expect(throws: APIError.timelineUnavailable) { try await h.read() }
    }

    @Test func a503WithoutTheCodeIsAServerError() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(503, json: "{}") }
        await #expect(throws: APIError.server(503)) { try await h.read() }
    }

    @Test func a401IsUnauthorized() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(401) }
        await #expect(throws: APIError.unauthorized) { try await h.read() }
    }

    @Test(arguments: [403, 404, 409, 429, 500, 502])
    func everyOtherStatusIsAServerError(status: Int) async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in StubResponse(status) }
        await #expect(throws: APIError.server(status)) { try await h.read() }
    }

    @Test(arguments: [URLError.timedOut, .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost])
    func offlineTransportErrorsMapToOffline(code: URLError.Code) async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in throw URLError(code) }
        await #expect(throws: APIError.offline) { try await h.read() }
    }

    @Test func otherTransportErrorsMapToInvalidResponseAndCancellationIsKept() async throws {
        let h = TimelineHarness()
        h.transport.route(timelinePath) { _ in throw URLError(.badServerResponse) }
        await #expect(throws: APIError.invalidResponse) { try await h.read() }
        h.transport.route(timelinePath) { _ in throw URLError(.cancelled) }
        await #expect(throws: CancellationError.self) { try await h.read() }
    }
}
