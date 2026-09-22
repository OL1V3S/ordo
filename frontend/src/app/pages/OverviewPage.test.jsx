import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { cashFlowApi } from "../../features/analytics/api/cashFlowApi";
import { cashFlowFixture } from "../../features/analytics/testFixtures";
import { budgetLimitsApi } from "../../features/budgetLimits/api/budgetLimitsApi";
import { commitmentsApi } from "../../features/commitments/api/commitmentsApi";
import { expensesApi } from "../../features/expenses/api/expensesApi";
import { paychecksApi } from "../../features/paychecks/api/paychecksApi";
import { clearSession, establishSession } from "../../shared/auth/session";

vi.mock("../../features/analytics/api/cashFlowApi", () => ({ cashFlowApi: { get: vi.fn() } }));
vi.mock("../../features/expenses/api/expensesApi", () => ({
  expensesApi: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../features/budgetLimits/api/budgetLimitsApi", () => ({
  budgetLimitsApi: { getByMonth: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../features/paychecks/api/paychecksApi", () => ({
  paychecksApi: {
    getCandidates: vi.fn(), getPaychecks: vi.fn(), getPaycheck: vi.fn(),
    confirmCandidate: vi.fn(), dismissCandidate: vi.fn(), reconsiderCandidate: vi.fn(),
    createPaycheck: vi.fn(), updatePaycheck: vi.fn(), updateLifecycle: vi.fn(),
  },
}));
vi.mock("../../features/commitments/api/commitmentsApi", () => ({
  commitmentsApi: {
    getCandidates: vi.fn(), dismissCandidate: vi.fn(), reconsiderCandidate: vi.fn(),
    confirmCandidate: vi.fn(), getCommitments: vi.fn(), getChanges: vi.fn(),
    acceptAmountChange: vi.fn(), acceptTimingChange: vi.fn(), markEndedFromChange: vi.fn(),
    keepChange: vi.fn(), reconsiderChange: vi.fn(), updateCommitment: vi.fn(), updateLifecycle: vi.fn(),
  },
}));

const response = (data) => ({ data });
const never = () => new Promise(() => {});

const expenses = [
  { id: "expense-b", description: "Rent", category: "bills", amount: 1200, date: "2026-08-14" },
  { id: "expense-a", description: "Utilities", category: "bills", amount: 15, date: "2026-08-14" },
  { id: "expense-c", description: "Gas", category: "transport", amount: 40, date: "2026-08-13" },
  { id: "expense-d", description: "Coffee", category: "Food", amount: 10, date: "2026-08-03" },
  { id: "expense-e", description: "Groceries", category: "food", amount: 90, date: "2026-08-02" },
  { id: "expense-f", description: "No-limit item", category: "zero", amount: 200, date: "2026-08-01" },
  { id: "expense-g", description: "Health item", category: "health", amount: 10, date: "2026-08-01" },
  { id: "expense-h", description: "Future purchase", category: "food", amount: 500, date: "2026-08-15" },
  { id: "expense-i", description: "Last month", category: "food", amount: 999, date: "2026-07-31" },
];

const limits = [
  { id: "limit-food", category: "food", limitAmount: 100 },
  { id: "limit-Food", category: "Food", limitAmount: 20 },
  { id: "limit-zero", category: "zero", limitAmount: 0 },
  { id: "limit-bills", category: "bills", limitAmount: 1000 },
  { id: "limit-transport", category: "transport", limitAmount: 20 },
  { id: "limit-health", category: "health", limitAmount: 10 },
];

function projection(amount, earliestExpectedDate, latestExpectedDate = earliestExpectedDate) {
  return {
    evaluatedOn: "2026-09-05",
    earliestExpectedDate,
    latestExpectedDate,
    amount: { mode: "fixed", fixedAmount: amount, minimumAmount: null, maximumAmount: null },
  };
}

const paychecks = [
  { id: "b", displayName: "Payroll B", lifecycle: "active", schedule: { cadence: "monthly" }, nextProjection: projection("9999999999999999.99", "2026-08-20") },
  { id: "a", displayName: "Payroll A", lifecycle: "active", schedule: { cadence: "monthly" }, nextProjection: projection("2500.00", "2026-08-20") },
  { id: "c", displayName: "Payroll C", lifecycle: "active", schedule: { cadence: "monthly" }, nextProjection: projection("3000.00", "2026-08-21") },
  { id: "paused", displayName: "Paused payroll", lifecycle: "paused", schedule: { cadence: "monthly" }, nextProjection: projection("100.00", "2026-08-01") },
  { id: "missing", displayName: "No server projection", lifecycle: "active", schedule: { cadence: "monthly" }, nextProjection: null },
];

const commitments = [
  { id: "commitment-1", name: "Rent plan", lifecycle: "active", cadence: "monthly", amountMode: "fixed", expectedAmount: "9999999999999999.99" },
  { id: "commitment-2", name: "Electric plan", lifecycle: "active", cadence: "monthly", amountMode: "range", expectedMinimumAmount: "75.25", expectedMaximumAmount: "125.75" },
  { id: "commitment-3", name: "Gym plan", lifecycle: "active", cadence: "weekly", amountMode: "fixed", expectedAmount: "20.00" },
  { id: "commitment-4", name: "Fourth active plan", lifecycle: "active", cadence: "monthly", amountMode: "fixed", expectedAmount: "30.00" },
  { id: "commitment-paused", name: "Paused plan", lifecycle: "paused", cadence: "monthly", amountMode: "fixed", expectedAmount: "40.00" },
];

function cashFlowData(overrides = {}) {
  return cashFlowFixture("2026-08", {
    cashInMinor: "999999999999999999",
    paycheckCashInMinor: "900000000000000000",
    otherCashInMinor: "99999999999999999",
    spentMinor: "123456789012345678",
    ...overrides,
  });
}

function renderPage() {
  return render(<MemoryRouter><OverviewPage /></MemoryRouter>);
}

function moduleNamed(name) {
  return screen.getByRole("heading", { level: 2, name }).closest("section");
}

function expectReadCounts({ cash = 1, spending = 1, budgets = 1, paycheck = 1, commitment = 1 } = {}) {
  expect(cashFlowApi.get).toHaveBeenCalledTimes(cash);
  expect(expensesApi.getAll).toHaveBeenCalledTimes(spending);
  expect(budgetLimitsApi.getByMonth).toHaveBeenCalledTimes(budgets);
  expect(paychecksApi.getPaychecks).toHaveBeenCalledTimes(paycheck);
  expect(commitmentsApi.getCommitments).toHaveBeenCalledTimes(commitment);
}

describe("Home current-month snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 14, 12, 0, 0));
    establishSession("owner-a", "a@example.test");
    vi.clearAllMocks();
    cashFlowApi.get.mockResolvedValue(response(cashFlowData()));
    expensesApi.getAll.mockResolvedValue(response(expenses));
    budgetLimitsApi.getByMonth.mockResolvedValue(response(limits));
    paychecksApi.getPaychecks.mockResolvedValue(response({ evaluatedOn: "2026-09-05", paychecks }));
    commitmentsApi.getCommitments.mockResolvedValue(response(commitments));
  });

  afterEach(() => {
    clearSession();
    vi.useRealTimers();
  });

  it("composes the approved five reads without recomputing cash flow or invoking review and mutation APIs", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Recorded cash in vs Spent" });

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    const cashFlow = screen.getByRole("region", { name: "This month’s recorded cash flow" });
    expect(cashFlow).toHaveTextContent("Recorded cash in$9,999,999,999,999,999.99");
    expect(cashFlow).toHaveTextContent("Spent$1,234,567,890,123,456.78");
    expect(cashFlow).toHaveTextContent("Through August 14, 2026");

    const paycheckModule = moduleNamed("Expected paychecks");
    const paycheckRows = within(paycheckModule).getAllByRole("listitem");
    expect(paycheckRows).toHaveLength(2);
    expect(paycheckRows[0]).toHaveTextContent("Payroll A$2,500.00");
    expect(paycheckRows[1]).toHaveTextContent("Payroll B$9,999,999,999,999,999.99");
    expect(paycheckModule).toHaveTextContent("Expected, not guaranteed.");
    expect(paycheckModule).toHaveTextContent("Expected Aug 20, 2026");
    expect(paycheckModule).toHaveTextContent("Evaluated Sep 5, 2026");
    expect(paycheckModule).not.toHaveTextContent("Payroll C");
    expect(paycheckModule).not.toHaveTextContent("Paused payroll");
    expect(paycheckModule).not.toHaveTextContent("No server projection");

    const budgetModule = moduleNamed("Budget attention");
    expect(within(budgetModule).getAllByRole("listitem")).toHaveLength(3);
    expect(budgetModule).toHaveTextContent("4 limits are at or above 90% used · 6 limits set");
    expect(budgetModule).toHaveTextContent("Food90.0% used$90.00 spent of $100.00");
    expect(budgetModule).not.toHaveTextContent("50.0% used");
    expect(budgetModule).not.toHaveTextContent("Zero");
    expect(budgetModule).not.toHaveTextContent("Health");

    const commitmentModule = moduleNamed("Active commitments");
    expect(commitmentModule).toHaveTextContent("4 active commitments");
    expect(within(commitmentModule).getAllByRole("listitem")).toHaveLength(3);
    expect(commitmentModule).toHaveTextContent("Rent plan$9,999,999,999,999,999.99");
    expect(commitmentModule).toHaveTextContent("Electric plan$75.25–$125.75");
    expect(commitmentModule).not.toHaveTextContent("Fourth active plan");
    expect(commitmentModule).not.toHaveTextContent("Paused plan");

    const spendingModule = moduleNamed("Recent spending");
    const spendingRows = within(spendingModule).getAllByRole("listitem");
    expect(spendingRows).toHaveLength(3);
    expect(spendingRows.map((row) => within(row).getAllByRole("strong")[0].textContent))
      .toEqual(["Utilities", "Rent", "Gas"]);
    expect(spendingModule).toHaveTextContent("This month · Through August 14, 2026");
    expect(spendingModule).not.toHaveTextContent("Future purchase");
    expect(spendingModule).not.toHaveTextContent("Last month");

    expect(screen.getByRole("link", { name: /Open activity/ })).toHaveAttribute("href", "/transactions");
    expect(screen.getByRole("link", { name: /View insights/ })).toHaveAttribute("href", "/analytics");
    expect(screen.getByRole("link", { name: /All paychecks/ })).toHaveAttribute("href", "/paychecks");
    expect(screen.getByRole("link", { name: /All budgets/ })).toHaveAttribute("href", "/budgets");
    expect(screen.getByRole("link", { name: /All commitments/ })).toHaveAttribute("href", "/commitments");
    expect(screen.getByRole("link", { name: /All spending/ })).toHaveAttribute("href", "/transactions");

    expect(cashFlowApi.get).toHaveBeenCalledWith("2026-08", "2026-08-14", expect.any(AbortSignal));
    expect(budgetLimitsApi.getByMonth).toHaveBeenCalledWith("2026-08");
    expectReadCounts();
    [expensesApi.create, expensesApi.update, expensesApi.remove,
      budgetLimitsApi.upsert, budgetLimitsApi.remove,
      paychecksApi.getCandidates, paychecksApi.getPaycheck, paychecksApi.confirmCandidate,
      paychecksApi.dismissCandidate, paychecksApi.reconsiderCandidate, paychecksApi.createPaycheck,
      paychecksApi.updatePaycheck, paychecksApi.updateLifecycle,
      commitmentsApi.getCandidates, commitmentsApi.getChanges, commitmentsApi.dismissCandidate,
      commitmentsApi.reconsiderCandidate, commitmentsApi.confirmCandidate,
      commitmentsApi.acceptAmountChange, commitmentsApi.acceptTimingChange,
      commitmentsApi.markEndedFromChange, commitmentsApi.keepChange, commitmentsApi.reconsiderChange,
      commitmentsApi.updateCommitment, commitmentsApi.updateLifecycle]
      .forEach((operation) => expect(operation).not.toHaveBeenCalled());
  });

  it("orders by the supplied server window before ID and renders the projected range instead of the profile amount", async () => {
    paychecksApi.getPaychecks.mockResolvedValue(response({
      evaluatedOn: "2026-09-05",
      paychecks: [
        {
          id: "a", displayName: "Later A", lifecycle: "active", schedule: { cadence: "monthly" },
          amount: { mode: "fixed", fixedAmount: "1.00" },
          nextProjection: projection("300.00", "2026-08-21"),
        },
        {
          id: "z", displayName: "Earlier Z", lifecycle: "active", schedule: { cadence: "semimonthly" },
          amount: { mode: "fixed", fixedAmount: "1.00" },
          nextProjection: {
            evaluatedOn: "2026-09-05",
            earliestExpectedDate: "2026-08-18",
            latestExpectedDate: "2026-08-19",
            amount: { mode: "range", fixedAmount: null, minimumAmount: "100.25", maximumAmount: "200.75" },
          },
        },
        {
          id: "b", displayName: "Middle B", lifecycle: "active", schedule: { cadence: "weekly" },
          amount: { mode: "fixed", fixedAmount: "1.00" },
          nextProjection: projection("250.00", "2026-08-20"),
        },
      ],
    }));
    renderPage();

    const module = moduleNamed("Expected paychecks");
    const rows = await within(module).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => within(row).getAllByRole("strong")[0].textContent))
      .toEqual(["Earlier Z", "Middle B"]);
    expect(rows[0]).toHaveTextContent("$100.25 – $200.75");
    expect(rows[0]).toHaveTextContent("Twice a month");
    expect(rows[0]).toHaveTextContent("Expected Aug 18, 2026 – Aug 19, 2026");
    expect(module).not.toHaveTextContent("Later A");
    expect(module).not.toHaveTextContent("$1.00");
  });

  it.each([
    ["spending list", () => expensesApi.getAll.mockResolvedValue(response({})), "We couldn’t load spending.", "No spending recorded in this period.", 2],
    ["budget-limit list", () => budgetLimitsApi.getByMonth.mockResolvedValue(response({})), "We couldn’t load budget limits.", "No budget limits are set for this month.", 1],
    ["paycheck envelope", () => paychecksApi.getPaychecks.mockResolvedValue(response([])), "We couldn’t load expected paychecks.", "No expected paycheck windows are available.", 1],
    ["commitment list", () => commitmentsApi.getCommitments.mockResolvedValue(response({})), "We couldn’t load active commitments.", "No active commitments.", 1],
  ])("treats a malformed %s response as unavailable rather than successfully empty", async (_name, arrange, error, empty, count) => {
    arrange();
    renderPage();

    expect(await screen.findAllByText(error)).toHaveLength(count);
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("keeps each module unavailable while its independent read is loading", () => {
    cashFlowApi.get.mockReturnValue(never());
    expensesApi.getAll.mockReturnValue(never());
    budgetLimitsApi.getByMonth.mockReturnValue(never());
    paychecksApi.getPaychecks.mockReturnValue(never());
    commitmentsApi.getCommitments.mockReturnValue(never());
    renderPage();

    expect(screen.getByText("Loading recorded cash flow...")).toBeInTheDocument();
    expect(screen.getByText("Loading expected paychecks...")).toBeInTheDocument();
    expect(screen.getAllByText("Loading spending...")).toHaveLength(2);
    expect(screen.getByText("Loading budget limits...")).toBeInTheDocument();
    expect(screen.getByText("Loading active commitments...")).toBeInTheDocument();
    expect(screen.queryByText("No expected paycheck windows are available.")).not.toBeInTheDocument();
    expect(screen.queryByText("No active commitments.")).not.toBeInTheDocument();
    expect(screen.queryByText("No spending recorded in this period.")).not.toBeInTheDocument();
  });

  it("keeps cash flow, paychecks, and commitments visible when spending fails, then retries only spending", async () => {
    expensesApi.getAll.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findAllByText("We couldn’t load spending.")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Recorded cash in vs Spent" })).toBeInTheDocument();
    expect(screen.getByText("Payroll A")).toBeInTheDocument();
    expect(screen.getByText("Rent plan")).toBeInTheDocument();
    expect(within(moduleNamed("Budget attention")).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(moduleNamed("Recent spending")).queryByRole("listitem")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Retry spending" })[0]);
    await within(moduleNamed("Recent spending")).findByText("Utilities");
    expectReadCounts({ spending: 2 });
  });

  it("keeps recent spending visible when budget limits fail, then retries only limits", async () => {
    budgetLimitsApi.getByMonth.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findByText("We couldn’t load budget limits.")).toBeInTheDocument();
    expect(within(moduleNamed("Recent spending")).getByText("Utilities")).toBeInTheDocument();
    expect(within(moduleNamed("Budget attention")).queryByRole("listitem")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry budget limits" }));
    await within(moduleNamed("Budget attention")).findByText("Food");
    expectReadCounts({ budgets: 2 });
  });

  it("does not create budget attention from an unsafe legacy limit", async () => {
    budgetLimitsApi.getByMonth.mockResolvedValue(response([
      { id: "unsafe", category: "food", limitAmount: Number("9999999999999999") },
    ]));
    renderPage();

    const budgetModule = moduleNamed("Budget attention");
    expect(await within(budgetModule).findByText(/Budget attention is unavailable for 1 limit/)).toBeVisible();
    expect(within(budgetModule).queryByRole("listitem")).not.toBeInTheDocument();
    expect(budgetModule).not.toHaveTextContent(/used of/);
  });

  it("keeps other modules visible when expected paychecks fail, then retries only paychecks", async () => {
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findByText("We couldn’t load expected paychecks.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recorded cash in vs Spent" })).toBeInTheDocument();
    expect(screen.getByText("Rent plan")).toBeInTheDocument();
    expect(within(moduleNamed("Recent spending")).getByText("Utilities")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry expected paychecks" }));
    await within(moduleNamed("Expected paychecks")).findByText("Payroll A");
    expectReadCounts({ paycheck: 2 });
  });

  it("keeps other modules visible when commitments fail, then retries only commitments", async () => {
    commitmentsApi.getCommitments.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findByText("We couldn’t load active commitments.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recorded cash in vs Spent" })).toBeInTheDocument();
    expect(screen.getByText("Payroll A")).toBeInTheDocument();
    expect(within(moduleNamed("Recent spending")).getByText("Utilities")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry active commitments" }));
    await within(moduleNamed("Active commitments")).findByText("Rent plan");
    expectReadCounts({ commitment: 2 });
  });

  it("keeps every secondary module visible when cash flow fails, then retries only cash flow", async () => {
    cashFlowApi.get.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findByText("We couldn’t load recorded cash flow. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Payroll A")).toBeInTheDocument();
    expect(within(moduleNamed("Budget attention")).getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Rent plan")).toBeInTheDocument();
    expect(within(moduleNamed("Recent spending")).getByText("Utilities")).toBeInTheDocument();
    expect(moduleNamed("Recent spending")).toHaveTextContent("This month · Through August 14, 2026");
    expect(moduleNamed("Recent spending")).not.toHaveTextContent("Future purchase");

    fireEvent.click(screen.getByRole("button", { name: "Retry cash flow" }));
    await screen.findByRole("heading", { name: "Recorded cash in vs Spent" });
    expectReadCounts({ cash: 2 });
  });

  it("shows successful empty states instead of treating them as failures", async () => {
    cashFlowApi.get.mockResolvedValue(response(cashFlowData({
      cashInMinor: "0", paycheckCashInMinor: "0", otherCashInMinor: "0", spentMinor: "0", netMinor: "0",
    })));
    expensesApi.getAll.mockResolvedValue(response([]));
    budgetLimitsApi.getByMonth.mockResolvedValue(response([]));
    paychecksApi.getPaychecks.mockResolvedValue(response({ evaluatedOn: "2026-09-05", paychecks: [] }));
    commitmentsApi.getCommitments.mockResolvedValue(response([]));
    renderPage();

    expect(await screen.findByText("No expected paycheck windows are available.")).toBeInTheDocument();
    expect(screen.getByText("No budget limits are set for this month.")).toBeInTheDocument();
    expect(screen.getByText("No active commitments.")).toBeInTheDocument();
    expect(screen.getByText("No spending recorded in this period.")).toBeInTheDocument();
    expect(screen.getByText("No cash in recorded")).toBeInTheDocument();
    expect(screen.getByText("No spending recorded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectReadCounts();
  });
});
