import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";
import { homeApi } from "../../features/home/api/homeApi";
import { expensesApi } from "../../features/expenses/api/expensesApi";
import { inflowsApi } from "../../features/inflows/api/inflowsApi";
import { clearSession, establishSession } from "../../shared/auth/session";
import i18n from "../../shared/localization/i18n";

vi.mock("../../features/home/api/homeApi", () => ({ homeApi: { getHome: vi.fn() } }));
vi.mock("../../features/expenses/api/expensesApi", () => ({ expensesApi: { create: vi.fn() } }));
vi.mock("../../features/inflows/api/inflowsApi", () => ({ inflowsApi: { create: vi.fn() } }));

const response = (data) => ({ data });
const home = (items = []) => ({
  generatedAt: "2026-09-01T12:00:00Z", currencyCode: "USD",
  evaluations: { activityThroughDate: "2026-09-01", upcomingEvaluatedOn: "2026-09-01" },
  attention: { availability: { state: "available", reasonCode: null }, items: [] },
  upcoming: { availability: { state: "available", reasonCode: null }, items: [] },
  recentActivity: { availability: { state: "available", reasonCode: null }, items },
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
});
afterEach(() => { clearSession(); sessionStorage.clear(); });

describe("capture-first Home", () => {
  it("uses only the Home endpoint, preserves server row order, and formats exact mixed activity", async () => {
    renderPage();
    expect(await screen.findByText("Cash deposit")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(homeApi.getHome).toHaveBeenCalledTimes(1);
    expect(screen.getByText("+$12.34")).toBeInTheDocument();
    expect(screen.getByText("−$9,999,999,999,999,999.99")).toBeInTheDocument();
    expect(screen.queryByText("Expected paychecks")).not.toBeInTheDocument();
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
