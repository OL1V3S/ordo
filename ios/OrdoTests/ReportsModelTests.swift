import Foundation
import Testing
@testable import Ordo

private let cashFlowPath = "/api/analytics/cash-flow"
private let october = ReportsFixtures.october
private let september = ReportsFixtures.september

private struct Failure: Error {}

@Suite struct ReportsAPITests {
    private func harness(_ status: Int = 200, body: String = "{}") -> (OrdoAPI, StubTransport) {
        let transport = StubTransport()
        transport.route(cashFlowPath) { _ in StubResponse(status, json: body) }
        return (OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport), transport)
    }

    @Test func theReadIsAnAuthorizedGetWithTheExactQuery() async throws {
        let (api, transport) = harness(body: "{\"ok\":1}")
        let data = try await api.cashFlow(accessToken: "access-1", month: october, throughDate: ReportsFixtures.through)
        #expect(String(decoding: data, as: UTF8.self) == "{\"ok\":1}")
        let request = try #require(transport.requests(cashFlowPath).first)
        #expect(request.httpMethod == "GET" && request.httpBody == nil)
        #expect(request.url?.query(percentEncoded: true) == "month=2026-10&throughDate=2026-10-20")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
    }

    @Test func keysAreZeroPadded() async throws {
        let (api, transport) = harness()
        _ = try await api.cashFlow(accessToken: "t", month: BudgetMonth(year: 1, month: 2)!, throughDate: CalendarDate("0001-02-03")!)
        #expect(transport.requests(cashFlowPath).first?.url?.query(percentEncoded: true) == "month=0001-02&throughDate=0001-02-03")
    }

    @Test func statusesMapTo401AndServerErrors() async throws {
        let (api401, _) = harness(401)
        await #expect(throws: APIError.unauthorized) { try await api401.cashFlow(accessToken: "t", month: october, throughDate: ReportsFixtures.through) }
        for status in [400, 404, 500, 503] {
            let (api, _) = harness(status, body: #"{"code":"cash_flow_period_invalid"}"#)
            await #expect(throws: APIError.server(status)) { try await api.cashFlow(accessToken: "t", month: october, throughDate: ReportsFixtures.through) }
        }
    }

    @Test func offlineAndTimeoutPropagate() async throws {
        for code in [URLError.notConnectedToInternet, URLError.timedOut] {
            let transport = StubTransport()
            transport.route(cashFlowPath) { _ in throw URLError(code) }
            let api = OrdoAPI(baseURL: URL(string: "http://localhost:5298")!, transport: transport)
            await #expect(throws: (any Error).self) { try await api.cashFlow(accessToken: "t", month: october, throughDate: ReportsFixtures.through) }
        }
    }
}

@MainActor @Suite struct ReportsViewModelTests {
    @Test func theFirstLoadUsesTheLocalMonthAndDateOnce() async {
        let service = ScriptedReportsService()
        let model = ReportsModelFactory.make(service)
        #expect(model.phase == .idle && model.month == october)
        await model.loadIfNeeded()
        await model.loadIfNeeded()
        #expect(service.requests.count == 1 && service.requests[0].month == october && service.requests[0].throughDate == ReportsFixtures.through)
        guard case .loaded(let report) = model.phase else { Issue.record("not loaded"); return }
        #expect(report.month == october && model.availableMonths == [october, september])
    }

    @Test func aMonthChangeHidesTheFiguresAndKeepsTheAvailableMonths() async {
        let gate = Gate()
        let service = ScriptedReportsService { month, through, index in
            if index == 2 { await gate.wait() }
            return ReportsFixtures.report(month: month, through: through)
        }
        let model = ReportsModelFactory.make(service)
        await model.loadIfNeeded()
        let task = Task { await model.select(september) }
        #expect(await waitUntil { await MainActor.run { model.phase == .loading } })
        #expect(model.month == september && model.availableMonths == [october, september])
        await gate.release()
        await task.value
        guard case .loaded(let report) = model.phase else { Issue.record("not loaded"); return }
        #expect(report.month == september)
    }

    @Test func aStaleResponseFromAnOlderMonthIsDropped() async {
        let gate = Gate()
        let service = ScriptedReportsService { month, through, index in
            if index == 2 { await gate.wait() } // the September read, started first
            return ReportsFixtures.report(month: month, through: through)
        }
        let model = ReportsModelFactory.make(service)
        await model.loadIfNeeded()
        let slow = Task { await model.select(september) }
        #expect(await waitUntil { service.requests.count == 2 })
        await model.select(october) // the newer choice finishes first
        await gate.release()
        await slow.value
        guard case .loaded(let report) = model.phase else { Issue.record("not loaded"); return }
        #expect(report.month == october && model.month == october)
    }

    @Test func aFailureThenRetrySucceeds() async {
        let service = ScriptedReportsService { month, through, index in
            if index == 1 { throw ReportsReadError.malformed }
            return ReportsFixtures.report(month: month, through: through)
        }
        let model = ReportsModelFactory.make(service)
        await model.loadIfNeeded()
        #expect(model.phase == .failed)
        await model.refresh()
        guard case .loaded = model.phase else { Issue.record("not loaded"); return }
    }

    @Test func aFailedRefreshClearsTheReportAndShowsTheError() async {
        let service = ScriptedReportsService { month, through, index in
            if index == 2 { throw Failure() }
            return ReportsFixtures.report(month: month, through: through)
        }
        let model = ReportsModelFactory.make(service)
        await model.loadIfNeeded()
        await model.refresh()
        #expect(model.phase == .failed)
    }

    @Test func stepsGoToListedMonthsAndThisMonthIsDisabledOnTheCurrentOne() async {
        let model = ReportsModelFactory.make()
        await model.loadIfNeeded()
        #expect(!model.canGoToCurrentMonth && !model.canStepLater && model.canStepEarlier)
        await model.stepEarlier()
        #expect(model.month == september && model.canGoToCurrentMonth && model.canStepLater)
        await model.goToCurrentMonth()
        #expect(model.month == october)
    }

    @Test func refreshIfLoadedDoesNothingBeforeTheFirstLoad() async {
        let service = ScriptedReportsService()
        let model = ReportsModelFactory.make(service)
        await model.refreshIfLoaded()
        #expect(service.requests.isEmpty && model.phase == .idle)
        await model.loadIfNeeded()
        await model.refreshIfLoaded()
        #expect(service.requests.count == 2)
    }

    @Test func resetClearsEverythingAndDropsALateResult() async {
        let gate = Gate()
        let service = ScriptedReportsService { month, through, index in
            if index == 3 { await gate.wait() }
            return ReportsFixtures.report(month: month, through: through)
        }
        let model = ReportsModelFactory.make(service)
        await model.loadIfNeeded()
        await model.select(september)
        let late = Task { await model.refresh() }
        #expect(await waitUntil { service.requests.count == 3 })
        model.reset()
        await gate.release()
        await late.value
        #expect(model.phase == .idle && model.availableMonths.isEmpty && model.month == october)
        await model.loadIfNeeded()
        #expect(service.requests.last?.month == october)
    }
}
