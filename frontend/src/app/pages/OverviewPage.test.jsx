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
const home = (items = [], upcoming = availableUpcoming()) => ({
  generatedAt: "2026-09-01T12:00:00Z", currencyCode: "USD",
  evaluations: { activityThroughDate: "2026-09-01", upcomingEvaluatedOn: "2026-09-01" },
  attention: { availability: { state: "available", reasonCode: null }, items: [] },
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
    expect(screen.getByText("No upcoming paycheck expectations to show.")).toBeInTheDocument();
    const headingOrder = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headingOrder.indexOf("Capture")).toBeLessThan(headingOrder.indexOf("Recent activity"));
    expect(headingOrder.indexOf("Recent activity")).toBeLessThan(headingOrder.indexOf("Coming Up"));
    expect(paychecksApi.getPaychecks).not.toHaveBeenCalled();
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
    expect(items[0]).toHaveTextContent("Cadence: Every two weeks");
    expect(items[1]).toHaveAccessibleName(/Second paycheck.*Expected range: \$1,234\.56–\$1,234\.57/);
    expect(items[1]).toHaveTextContent("Expected window Sep 9, 2026–Sep 12, 2026");
    expect(items[1]).toHaveTextContent("Cadence: Monthly");
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

  it("localizes expected money, dates, section labels, and accessible rows in Spanish", async () => {
    await i18n.changeLanguage("es");
    homeApi.getHome.mockResolvedValue(response(home([], availableUpcoming([projection({
      earliestExpectedDate: "2026-09-12", anchorDate: "2026-09-12", latestExpectedDate: "2026-09-12",
    })]))));
    renderPage();
    const list = await screen.findByRole("list", { name: "Previsiones de pagos de nómina" });
    expect(screen.getByRole("heading", { name: "Próximos pagos de nómina" })).toBeInTheDocument();
    expect(within(list).getByText("Monto previsto: $9,999,999,999,999,999.99")).toBeInTheDocument();
    expect(within(list).getByText("Previsto para el 12 sept 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver pagos de nómina" })).toHaveAttribute("href", "/paychecks");
    expect(within(list).getByRole("listitem")).toHaveAccessibleName(/Primary paycheck.*Monto previsto/);
  });

  it("renders separate loading and whole-Home failure states without fabricated expectations", async () => {
    let resolveHome;
    homeApi.getHome.mockReturnValue(new Promise((resolve) => { resolveHome = resolve; }));
    const view = renderPage();
    expect(screen.getByText("Loading expected paychecks…")).toBeInTheDocument();
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
});
