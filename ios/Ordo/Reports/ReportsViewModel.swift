import Foundation
import Observation
import os

/// The Reports screen: one read-only cash-flow report for the chosen month. Nothing is written, so
/// there is no uncertain outcome. Every figure is shown exactly as the server sent it.
///
/// ```
/// idle --loadIfNeeded--> loading --200, valid, same period--> loaded
///                                --anything else-----------> failed (Retry, pull to refresh)
/// loaded --select(month)--> loading          loaded --refresh--> loaded | failed
/// ```
/// A failed refresh clears the report and shows the load error, as on the web. `availableMonths`
/// from the last success is kept while the month changes. Nothing is persisted or logged.
@MainActor @Observable
final class ReportsViewModel {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded(CashFlowReport)
        case failed
    }

    private(set) var month: BudgetMonth
    private(set) var phase: Phase = .idle
    private(set) var availableMonths: [BudgetMonth] = []

    @ObservationIgnored private let service: ReportsService
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let timeZone: @Sendable () -> TimeZone
    @ObservationIgnored private let logger = Logger(subsystem: "app.ordo", category: "reports")
    /// Advanced by every read and by `reset()`; an older result is dropped.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var started = false

    init(service: ReportsService,
         now: @escaping @Sendable () -> Date = { Date() },
         timeZone: @escaping @Sendable () -> TimeZone = { TimeZone.current }) {
        self.service = service
        self.now = now
        self.timeZone = timeZone
        month = BudgetMonth.current(now: now(), timeZone: timeZone())
    }

    var currentMonth: BudgetMonth { BudgetMonth.current(now: now(), timeZone: timeZone()) }
    var monthOptions: [BudgetMonth] {
        ReportsPresenter.monthOptions(current: currentMonth, selected: month, available: availableMonths)
    }
    var canStepEarlier: Bool { ReportsPresenter.neighbor(of: month, in: monthOptions, direction: -1) != nil }
    var canStepLater: Bool { ReportsPresenter.neighbor(of: month, in: monthOptions, direction: 1) != nil }
    var canGoToCurrentMonth: Bool { month != currentMonth }

    /// First appearance of the tab.
    func loadIfNeeded() async {
        guard !started else { return }
        await start(showLoading: true)
    }

    /// Pull to refresh and Retry.
    func refresh() async {
        await start(showLoading: !isLoaded)
    }

    /// After a write elsewhere: only when the tab has been opened.
    func refreshIfLoaded() async {
        guard started else { return }
        await start(showLoading: false)
    }

    func select(_ newMonth: BudgetMonth) async {
        guard newMonth != month || !isLoaded else { return }
        month = newMonth
        await start(showLoading: true)
    }

    func stepEarlier() async {
        if let target = ReportsPresenter.neighbor(of: month, in: monthOptions, direction: -1) { await select(target) }
    }

    func stepLater() async {
        if let target = ReportsPresenter.neighbor(of: month, in: monthOptions, direction: 1) { await select(target) }
    }

    func goToCurrentMonth() async {
        guard canGoToCurrentMonth else { return }
        await select(currentMonth)
    }

    /// Sign-out and session change: everything is dropped and a late result is ignored.
    func reset() {
        generation += 1
        started = false
        phase = .idle
        availableMonths = []
        month = currentMonth
    }

    private var isLoaded: Bool {
        if case .loaded = phase { return true }
        return false
    }

    private func start(showLoading: Bool) async {
        started = true
        generation += 1
        let token = generation
        if showLoading { phase = .loading }
        let requested = month
        let through = DateFormatting.localCalendarDate(now: now(), timeZone: timeZone())
        let service = self.service
        // An unstructured task, so a cancelled pull to refresh does not turn into a failure.
        let task = Task { try await service.loadCashFlow(month: requested, throughDate: through) }
        let result = await task.result
        guard token == generation else { return }
        switch result {
        case .success(let report):
            availableMonths = report.availableMonths
            phase = .loaded(report)
        case .failure:
            logger.error("The cash-flow report could not be loaded.")
            phase = .failed
        }
    }
}
