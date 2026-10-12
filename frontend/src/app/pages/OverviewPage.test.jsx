import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { homeApi } from "../../features/home/api/homeApi";
import { paychecksApi } from "../../features/paychecks/api/paychecksApi";
import { expensesApi } from "../../features/expenses/api/expensesApi";
import { inflowsApi } from "../../features/inflows/api/inflowsApi";
import { isHomeAttentionSection } from "../../features/home/utils/homePresentation";
import { clearSession, establishSession } from "../../shared/auth/session";
import i18n from "../../shared/localization/i18n";

vi.mock("../../features/home/api/homeApi", () => ({ homeApi: { getHome: vi.fn() } }));
vi.mock("../../features/paychecks/api/paychecksApi", () => ({ paychecksApi: { getPaychecks: vi.fn() } }));
vi.mock("../../features/expenses/api/expensesApi", () => ({ expensesApi: { create: vi.fn() } }));
vi.mock("../../features/inflows/api/inflowsApi", () => ({ inflowsApi: { create: vi.fn() } }));

const response = (data) => ({ data });
const availableUpcoming = (items = []) => ({
  availability: { state: "available", reasonCode: null },
  horizon: { from: "2026-09-01", through: "2026-09-14" },
  items,
});
const availableAttention = (items = [], budgetItems = []) => ({
  availability: { state: "available", reasonCode: null },
  kindsEvaluated: ["commitment_change_review", "budget_attention"],
  items, budgetItems,
  familyAvailability: {
    commitment_change_review: { state: "available", reasonCode: null },
    budget_attention: { state: "available", reasonCode: null },
  },
  evaluatedOn: "2026-09-01",
});
const home = (items = [], upcoming = availableUpcoming(), attention = availableAttention()) => ({
  generatedAt: "2026-09-01T12:00:00Z", currencyCode: "USD",
  evaluations: { activityThroughDate: "2026-09-01", upcomingEvaluatedOn: "2026-09-01" },
  attention,
  upcoming,
  recentActivity: { availability: { state: "available", reasonCode: null }, items },
});
const projection = (overrides = {}) => ({
  kind: "paycheck_projection",
  paycheckProfileId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
  displayName: "Primary paycheck",
  cadence: "biweekly",
  anchorDate: "2026-09-12",
  earliestExpectedDate: "2026-09-11",
  latestExpectedDate: "2026-09-13",
  amount: { mode: "fixed", fixedAmount: "9999999999999999.99", minimumAmount: null, maximumAmount: null },
  ...overrides,
});
function renderPage() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><OverviewPage /></MemoryRouter></I18nextProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  establishSession("test-token", "owner@example.test");
  homeApi.getHome.mockResolvedValue(response(home([
    { kind: "account_inflow", recordId: 2, date: "2026-08-31", amount: "12.34", description: "Cash deposit", category: null, paycheck: null },
    { kind: "expense", recordId: 1, date: "2026-08-30", amount: "9999999999999999.99", description: "Rent", category: "Housing", paycheck: null },
  ])));
  expensesApi.create.mockResolvedValue({ data: {} });
  inflowsApi.create.mockResolvedValue({ data: {} });
  paychecksApi.getPaychecks.mockReset();
});
afterEach(async () => { clearSession(); sessionStorage.clear(); await i18n.changeLanguage("en"); });

describe("capture-first Home", () => {
  it("uses only the Home endpoint, preserves server row order, and formats exact mixed activity", async () => {
    renderPage();
    expect(await screen.findByText("Cash deposit")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(homeApi.getHome).toHaveBeenCalledTimes(1);
    expect(screen.getByText("+$12.34")).toBeInTheDocument();
    expect(screen.getByText("−$9,999,999,999,999,999.99")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming Up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs Attention" })).toBeInTheDocument();
    expect(screen.getByText("No upcoming paycheck expectations to show.")).toBeInTheDocument();
    const headingOrder = screen.getAllByRole("heading").map((heading) => heading.textContent);
    const captureRegion = screen.getByRole("region", { name: "Capture" });
    expect(captureRegion.compareDocumentPosition(screen.getByRole("region", { name: "Needs Attention" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headingOrder.indexOf("Needs Attention")).toBeLessThan(headingOrder.indexOf("Recent activity"));
    expect(headingOrder.indexOf("Recent activity")).toBeLessThan(headingOrder.indexOf("Coming Up"));
    expect(paychecksApi.getPaychecks).not.toHaveBeenCalled();
  });

  it("renders grouped pending reviews in server order and links beyond the two-group presentation bound", async () => {
    const attention = availableAttention(["a", "b", "c"].map((id, index) => ({
        kind: "commitment_change_review", commitmentId: `b375a2a2-3f95-43b0-985e-a9360237b0${id}7`,
        commitmentName: `Commitment ${index + 1}`,
        reviews: [{ dimension: index === 0 ? "amount" : "missing", state: index === 0 ? "proposed_change" : "possibly_ended" }],
      })));
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));
    renderPage();
    const list = await screen.findByRole("list", { name: "Items needing attention" });
    expect(within(list).getByText("Commitment 1")).toBeInTheDocument();
    expect(within(list).getByText("Commitment 2")).toBeInTheDocument();
    expect(within(list).queryByText("Commitment 3")).not.toBeInTheDocument();
    expect(within(list).getByText("Amount change to review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all 3 reviews" })).toHaveAttribute("href", "/commitments#changes-review-heading");
    expect(homeApi.getHome).toHaveBeenCalledTimes(1);
    expect(paychecksApi.getPaychecks).not.toHaveBeenCalled();
  });

  it("localizes attention copy while preserving the user-entered commitment name", async () => {
    await i18n.changeLanguage("es");
    const attention = availableAttention([{
        kind: "commitment_change_review", commitmentId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
        commitmentName: "Mi Gimnasio", reviews: [{ dimension: "timing", state: "proposed_change" }],
      }]);
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Requiere atención" })).toBeInTheDocument();
    expect(screen.getByText("Mi Gimnasio")).toBeInTheDocument();
    expect(screen.getByText("Cambio de fecha por revisar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir revisiones de compromisos" }))
      .toHaveAttribute("href", "/commitments#changes-review-heading");
  });

  it("words an over-limit budget alert in Spanish with Por encima del límite", async () => {
    await i18n.changeLanguage("es");
    const attention = availableAttention([], [
      { kind: "budget_attention", category: "Groceries", state: "over_limit", spentAmount: "110.00", limitAmount: "100.00" },
    ]);
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));

    renderPage();

    const list = await screen.findByRole("list", { name: "Elementos que requieren atención" });
    expect(within(list).getByText("Groceries")).toBeInTheDocument();
    expect(within(list).getByText("Por encima del límite: se gastaron USD 110.00 de USD 100.00.")).toBeInTheDocument();
  });

  it("orders budget alerts with commitment reviews and applies the shared two-row cap", async () => {
    const attention = availableAttention(
      ["a", "b", "c"].map((id, index) => ({
        kind: "commitment_change_review", commitmentId: `c375a2a2-3f95-43b0-985e-a9360237b0${id}7`,
        commitmentName: `Commitment ${index + 1}`,
        reviews: [{ dimension: "amount", state: "proposed_change" }],
      })),
      [
        { kind: "budget_attention", category: "Groceries", state: "over_limit", spentAmount: "110.00", limitAmount: "100.00" },
        { kind: "budget_attention", category: "Food", state: "at_limit", spentAmount: "50.00", limitAmount: "50.00" },
      ],
    );
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));

    renderPage();

    const list = await screen.findByRole("list", { name: "Items needing attention" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Groceries")).toBeInTheDocument();
    expect(within(list).getByText("Over limit: $110.00 spent against $100.00.")).toBeInTheDocument();
    expect(within(list).getByText("Commitment 1")).toBeInTheDocument();
    expect(within(list).queryByText("Commitment 2")).not.toBeInTheDocument();
    expect(within(list).queryByText("Food")).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Open Groceries budget" })).toHaveAttribute("href", "/budgets");
    expect(screen.getByRole("link", { name: "See all 3 reviews" }))
      .toHaveAttribute("href", "/commitments#changes-review-heading");
  });

  it("shows trustworthy commitment reviews and a partial warning when budget attention is unavailable", async () => {
    const attention = {
      ...availableAttention([{
        kind: "commitment_change_review", commitmentId: "b375a2a2-3f95-43b0-985e-a9360237b0b7",
        commitmentName: "Gym plan", reviews: [{ dimension: "timing", state: "proposed_change" }],
      }]),
      kindsEvaluated: ["commitment_change_review"],
      budgetItems: null,
      familyAvailability: {
        commitment_change_review: { state: "available", reasonCode: null },
        budget_attention: { state: "unavailable", reasonCode: "source_unavailable" },
      },
    };
    expect(isHomeAttentionSection(attention, "2026-09-01")).toBe(true);
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));

    renderPage();

    expect(await screen.findByText("Gym plan")).toBeInTheDocument();
    expect(screen.getByText("Some attention items could not be checked. Available items are shown.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /budget/i })).not.toBeInTheDocument();
  });

  it("shows budget attention when commitment evaluation fails and localizes its action in Spanish", async () => {
    await i18n.changeLanguage("es");
    const attention = {
      ...availableAttention(null, [{
        kind: "budget_attention", category: "Salud", state: "zero_limit_spending",
        spentAmount: "1.25", limitAmount: "0.00",
      }]),
      kindsEvaluated: ["budget_attention"],
      items: null,
      familyAvailability: {
        commitment_change_review: { state: "unavailable", reasonCode: "source_unavailable" },
        budget_attention: { state: "available", reasonCode: null },
      },
    };
    expect(isHomeAttentionSection(attention, "2026-09-01")).toBe(true);
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming(), attention)));

    renderPage();

    const list = await screen.findByRole("list", { name: "Elementos que requieren atención" });
    expect(within(list).getByText("Se gastaron USD 1.25 con un límite de cero.")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Abrir el presupuesto de Salud" })).toHaveAttribute("href", "/budgets");
    expect(screen.getByText("No se pudieron revisar algunos elementos. Se muestran los que están disponibles.")).toBeInTheDocument();
  });

  it("renders at most two server-ordered overlapping expectations with exact amounts and dates", async () => {
    const first = projection();
    const second = projection({
      paycheckProfileId: "c375a2a2-3f95-43b0-985e-a9360237b0b7",
      displayName: "Second paycheck",
      cadence: "monthly",
      anchorDate: "2026-09-10",
      earliestExpectedDate: "2026-09-09",
      latestExpectedDate: "2026-09-12",
      amount: { mode: "range", fixedAmount: null, minimumAmount: "1234.56", maximumAmount: "1234.57" },
    });
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([first, second]))));
    renderPage();

    const list = await screen.findByRole("list", { name: "Expected paycheck projections" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName(/Primary paycheck.*Expected amount: \$9,999,999,999,999,999\.99/);
    expect(items[0]).toHaveTextContent("Expected window Sep 11, 2026–Sep 13, 2026");
    expect(items[0]).toHaveTextContent("Every two weeks");
    expect(items[0]).toHaveAccessibleName(/Cadence: Every two weeks/);
    expect(items[1]).toHaveAccessibleName(/Second paycheck.*Expected range: \$1,234\.56–\$1,234\.57/);
    expect(items[1]).toHaveTextContent("Expected window Sep 9, 2026–Sep 12, 2026");
    expect(items[1]).toHaveTextContent("Monthly");
    expect(screen.getByRole("link", { name: "View paychecks" })).toHaveAttribute("href", "/paychecks");
    expect(homeApi.getHome).toHaveBeenCalledTimes(1);
    expect(paychecksApi.getPaychecks).not.toHaveBeenCalled();

    const activity = screen.getByRole("region", { name: "Recent activity" });
    expect(within(activity).queryByText("Primary paycheck")).not.toBeInTheDocument();
    const comingUp = screen.getByRole("region", { name: "Coming Up" });
    expect(comingUp.textContent).not.toMatch(/received|late|available|balance|safe to spend|total/i);
    expect(comingUp.textContent).not.toMatch(/\+\$/);
  });

  it("shows only one-day wording and treats more than two records as malformed", async () => {
    const oneDay = projection({
      earliestExpectedDate: "2026-09-12", anchorDate: "2026-09-12", latestExpectedDate: "2026-09-12",
    });
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([oneDay]))));
    const view = renderPage();
    const list = await screen.findByRole("list", { name: "Expected paycheck projections" });
    expect(within(list).getByText("Expected Sep 12, 2026")).toBeInTheDocument();
    expect(within(list).queryByText(/Expected window/)).not.toBeInTheDocument();

    view.unmount();
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([oneDay, oneDay, oneDay]))));
    renderPage();
    expect(await screen.findByText("Paycheck expectations could not be verified, so they are hidden.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Expected paycheck projections" })).not.toBeInTheDocument();
  });

  it("keeps Recent Activity usable when Upcoming is unavailable or malformed", async () => {
    homeApi.getHome.mockResolvedValue(response(home([
      { kind: "expense", recordId: 10, date: "2026-09-01", amount: "12.00", description: "Still visible", category: "food", paycheck: null },
    ], { availability: { state: "unavailable", reasonCode: "source_unavailable" }, horizon: { from: "2026-09-01", through: "2026-09-14" }, items: null })));
    const view = renderPage();
    expect(await screen.findByText("Still visible")).toBeInTheDocument();
    expect(screen.getByText("Upcoming paycheck expectations are unavailable right now.")).toBeInTheDocument();

    view.unmount();
    homeApi.getHome.mockResolvedValue(response(home([
      { kind: "expense", recordId: 11, date: "2026-09-01", amount: "13.00", description: "Still visible when malformed", category: "food", paycheck: null },
    ], availableUpcoming([projection({ amount: { mode: "fixed", fixedAmount: "1.0", minimumAmount: null, maximumAmount: null } })]))));
    renderPage();
    expect(await screen.findByText("Still visible when malformed")).toBeInTheDocument();
    expect(screen.getByText("Paycheck expectations could not be verified, so they are hidden.")).toBeInTheDocument();
  });

  it("keeps valid Home sections available when the attention envelope is from an older backend", async () => {
    homeApi.getHome.mockResolvedValue(response(home([
      { kind: "expense", recordId: 12, date: "2026-09-01", amount: "13.00", description: "Activity survives version skew", category: "food", paycheck: null },
    ], availableUpcoming([projection()]), {
      availability: { state: "available", reasonCode: null },
      kindsEvaluated: [],
      items: [],
    })));

    renderPage();

    expect(await screen.findByText("Activity survives version skew")).toBeInTheDocument();
    expect(screen.getByText("Attention items could not be verified, so they are hidden.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Expected paycheck projections" })).toBeInTheDocument();
    expect(screen.getByText("Primary paycheck")).toBeInTheDocument();
  });

  it("localizes expected money, dates, section labels, and accessible rows in Spanish", async () => {
    await i18n.changeLanguage("es");
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([projection({
      earliestExpectedDate: "2026-09-12", anchorDate: "2026-09-12", latestExpectedDate: "2026-09-12",
    })]))));
    renderPage();
    const list = await screen.findByRole("list", { name: "Previsiones de pagos de nómina" });
    expect(screen.getByRole("heading", { name: "Próximos pagos de nómina" })).toBeInTheDocument();
    expect(within(list).getByText("USD 9,999,999,999,999,999.99")).toBeInTheDocument();
    expect(within(list).getByText("Previsto para el 12 sep 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver pagos de nómina" })).toHaveAttribute("href", "/paychecks");
    expect(within(list).getByRole("listitem")).toHaveAccessibleName(/Primary paycheck.*Monto previsto/);
  });

  it("renders separate loading and whole-Home failure states without fabricated expectations", async () => {
    let resolveHome;
    homeApi.getHome.mockReturnValue(new Promise((resolve) => { resolveHome = resolve; }));
    const view = renderPage();
    expect(screen.getByText("Loading expected paychecks…")).toBeInTheDocument();
    expect(screen.getByText("Loading attention items…")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Expected paycheck projections" })).not.toBeInTheDocument();
    resolveHome(response(home()));
    await screen.findByText("No upcoming paycheck expectations to show.");
    view.unmount();
    homeApi.getHome.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByText("Coming Up is unavailable because Home could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Home" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Expected paycheck projections" })).not.toBeInTheDocument();
  });

  it("blocks the other capture while one is open and performs a Home refresh after success", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByRole("button", { name: "Add cash in" })).toBeDisabled();
    await user.type(screen.getByLabelText("Description"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.type(screen.getByLabelText("Date"), "2026-09-01");
    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    await screen.findByText("Expense saved.");
    expect(expensesApi.create).toHaveBeenCalledWith({ description: "lunch", amount: "12.50", date: "2026-09-01", category: "food" });
    expect(homeApi.getHome).toHaveBeenCalledTimes(2);
  });

  it("restores focus to the Home capture action after cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    const opener = screen.getByRole("button", { name: "Add expense" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("records only a source marker for an unknown write and sends recovery to Activity", async () => {
    const user = userEvent.setup();
    expensesApi.create.mockRejectedValue(new Error("network outcome unknown"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.type(screen.getByLabelText("Description"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.type(screen.getByLabelText("Date"), "2026-09-01");
    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByRole("link", { name: "Open Activity to check" })).toHaveAttribute("href", "/transactions");
    expect(sessionStorage.getItem("ordo-home-uncertain-write:owner%40example.test")).toBe("expense");
    expect(sessionStorage.length).toBe(1);
    expect(screen.getByRole("button", { name: "Add cash in" })).toBeDisabled();
    expect(homeApi.getHome).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Activity to check" })).toHaveFocus());
  });

  it("keeps a create 404 on the unknown path: marker recorded and no missing wording", async () => {
    const user = userEvent.setup();
    expensesApi.create.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.type(screen.getByLabelText("Description"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.type(screen.getByLabelText("Date"), "2026-09-01");
    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByRole("link", { name: "Open Activity to check" })).toHaveAttribute("href", "/transactions");
    expect(sessionStorage.getItem("ordo-home-uncertain-write:owner%40example.test")).toBe("expense");
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  });

  it("keeps an unknown Cash In marker through a successful Home read and focuses the Activity handoff", async () => {
    const user = userEvent.setup();
    homeApi.getHome.mockRejectedValueOnce(new Error("Home unavailable")).mockResolvedValue(response(home()));
    inflowsApi.create.mockRejectedValue(new Error("network outcome unknown"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add cash in" }));
    const cashForm = screen.getByRole("form", { name: "Add cash in" });
    await user.type(within(cashForm).getByLabelText("Description"), "Refund");
    await user.type(within(cashForm).getByLabelText("Amount"), "3.45");
    fireEvent.change(within(cashForm).getByLabelText("Date"), { target: { value: "2026-09-01" } });
    await user.click(within(cashForm).getByRole("button", { name: "Add cash in" }));

    const handoff = await screen.findByRole("link", { name: "Open Activity to check" });
    await waitFor(() => expect(handoff).toHaveFocus());
    expect(inflowsApi.create).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("ordo-home-uncertain-write:owner%40example.test")).toBe("account_inflow");
    await user.click(screen.getByRole("button", { name: "Retry Home" }));
    await waitFor(() => expect(homeApi.getHome).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("link", { name: "Open Activity to check" })).toBeInTheDocument();
    expect(sessionStorage.getItem("ordo-home-uncertain-write:owner%40example.test")).toBe("account_inflow");
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
  });

  it("does not create a marker for client-side validation", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Complete the required expense fields.");
    expect(expensesApi.create).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps a confirmed write gated when the Home refresh fails", async () => {
    const user = userEvent.setup();
    homeApi.getHome.mockResolvedValueOnce(response(home())).mockRejectedValueOnce(new Error("offline"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add cash in" }));
    const cashForm = screen.getByRole("form", { name: "Add cash in" });
    await user.type(within(cashForm).getByLabelText("Description"), "Refund");
    await user.type(within(cashForm).getByLabelText("Amount"), "3.45");
    fireEvent.change(within(cashForm).getByLabelText("Date"), { target: { value: "2026-09-01" } });
    await user.click(within(cashForm).getByRole("button", { name: "Add cash in" }));
    expect(await screen.findByText(/Cash in saved\. Home activity could not be refreshed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
    expect(sessionStorage.length).toBe(0);
  });

  it("has one h1, no intro or Capture heading, and a labelled Capture region", async () => {
    renderPage();
    await screen.findByText("Cash deposit");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Home"]);
    expect(screen.queryByRole("heading", { name: "Capture" })).not.toBeInTheDocument();
    expect(screen.queryByText("Keep today’s money activity current.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Capture" })).toBeInTheDocument();
  });

  it("exposes a single Add disclosure that toggles the expense-first options group", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getByRole("button", { name: "Add" });
    const group = document.getElementById("home-add-options");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "home-add-options");
    expect(group).toHaveAttribute("data-collapsed", "true");
    const labels = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Add expense", "Add cash in"]);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(group).not.toHaveAttribute("data-collapsed");
    expect(toggle).toHaveFocus();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveAttribute("data-collapsed", "true");
  });

  it("forces the Add group open while a capture is active and announces the lock once", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getByRole("button", { name: "Add" });
    await user.click(toggle);
    await user.click(toggle);
    const opener = screen.getByRole("button", { name: "Add cash in" });
    await user.click(toggle);
    await user.click(opener);
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleDescription("Finish or cancel the open capture before starting another.");
    expect(screen.getAllByText("Finish or cancel the open capture before starting another.").filter((n) => n.classList.contains("sr-only"))).toHaveLength(1);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("home-add-options")).not.toHaveAttribute("data-collapsed");
    const form = screen.getByRole("form", { name: "Add cash in" });
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(document.getElementById("home-add-options")).not.toHaveAttribute("data-collapsed");
  });

  it("shows only the value in Coming Up amounts and one compact meta line per row", async () => {
    const second = projection({
      paycheckProfileId: "c375a2a2-3f95-43b0-985e-a9360237b0b7", displayName: "Second paycheck", cadence: "monthly",
      anchorDate: "2026-09-10", earliestExpectedDate: "2026-09-09", latestExpectedDate: "2026-09-12",
      amount: { mode: "range", fixedAmount: null, minimumAmount: "1234.56", maximumAmount: "1234.57" },
    });
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([projection(), second]))));
    renderPage();
    const list = await screen.findByRole("list", { name: "Expected paycheck projections" });
    const items = within(list).getAllByRole("listitem");
    for (const item of items) expect(item.querySelectorAll(".ui-list-row__meta")).toHaveLength(1);
    expect(items[0].querySelector(".ui-list-row__amount")).toHaveTextContent(/^\$9,999,999,999,999,999\.99$/);
    expect(items[1].querySelector(".ui-list-row__amount")).toHaveTextContent(/^\$1,234\.56–\$1,234\.57$/);
    expect(items[0].querySelector(".ui-list-row__meta")).toHaveTextContent("Every two weeks · Expected window Sep 11, 2026–Sep 13, 2026");
    expect(list).not.toHaveTextContent("+");
  });

  it("localizes the Add entry and Capture region in Spanish", async () => {
    await i18n.changeLanguage("es");
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([projection()]))));
    renderPage();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Registrar" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Previsiones de pagos de nómina" });
    expect(list).toHaveTextContent("Cada dos semanas");
  });

  it("renders the recovery heading as a level-2 heading", async () => {
    const user = userEvent.setup();
    expensesApi.create.mockRejectedValue(new Error("network outcome unknown"));
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await user.type(screen.getByLabelText("Description"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "12.50");
    await user.type(screen.getByLabelText("Date"), "2026-09-01");
    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Check the complete activity list" })).toBeInTheDocument();
  });
});
