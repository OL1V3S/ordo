import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../shared/localization/i18n";
import source from "./ActivityTimeline.jsx?raw";
import ActivityTimeline from "./ActivityTimeline";

const expense = (overrides = {}) => ({
  kind: "expense", recordId: 1, date: "2026-09-22", amount: "12.34",
  description: "Corner coffee", category: "food", paycheck: null, ...overrides,
});
const inflow = (overrides = {}) => ({
  kind: "account_inflow", recordId: 1, date: "2026-09-21", amount: "2500.00",
  description: "Payroll deposit", category: null,
  paycheck: { profileId: "11111111-1111-1111-1111-111111111111", relation: "recorded_receipt" }, ...overrides,
});
const state = (overrides = {}) => ({
  items: [], hasMore: false, loading: false, error: false, refreshFailed: false, malformed: false,
  loadingMore: false, loadMoreFailed: false,
  loadMore: vi.fn().mockResolvedValue({ stale: false }), refresh: vi.fn().mockResolvedValue({ stale: false }),
  ...overrides,
});
function renderTimeline(timeline, props = {}) {
  const view = render(<I18nextProvider i18n={i18n}><ActivityTimeline timeline={timeline} {...props} /></I18nextProvider>);
  return {
    ...view,
    rerenderTimeline: (next, nextProps = props) => view.rerender(
      <I18nextProvider i18n={i18n}><ActivityTimeline timeline={next} {...nextProps} /></I18nextProvider>),
  };
}

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("ActivityTimeline", () => {
  it("is a labelled region whose rows distinguish money out from money in by text and sign", () => {
    renderTimeline(state({ items: [expense(), inflow()] }));

    const region = screen.getByRole("region", { name: "Activity timeline" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(region).queryByRole("table")).not.toBeInTheDocument();
    expect(within(rows[0]).getByText("Expense")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Corner coffee")).toBeInTheDocument();
    expect(within(rows[0]).getByText("−$12.34")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/food/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Sep 22, 2026").tagName).toBe("TIME");
    expect(within(rows[1]).getByText("Cash in")).toBeInTheDocument();
    expect(within(rows[1]).getByText("+$2,500.00")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Paycheck linked/)).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/food/)).not.toBeInTheDocument();
  });

  it("shows an exact amount above the safe-integer range without rounding", () => {
    renderTimeline(state({ items: [expense({ amount: "9999999999999999.99" })] }));

    expect(screen.getByText("−$9,999,999,999,999,999.99")).toBeInTheDocument();
  });

  it("degrades only the row of a legacy zero or negative amount and shows the stored value", () => {
    renderTimeline(state({ items: [
      expense({ recordId: 1, amount: "0.00", description: "Legacy zero" }),
      expense({ recordId: 2, amount: "-5.00", description: "Legacy negative" }),
      expense({ recordId: 3, amount: "3.00", description: "Normal" }),
    ] }));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Amount needs review")).toBeInTheDocument();
    expect(within(rows[0]).getByText("0.00")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Amount needs review")).toBeInTheDocument();
    expect(within(rows[1]).getByText("-5.00")).toBeInTheDocument();
    expect(within(rows[2]).getByText("−$3.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces loading politely and marks the region busy", () => {
    renderTimeline(state({ loading: true }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading the activity timeline…");
    expect(screen.getByRole("region", { name: "Activity timeline" })).toHaveAttribute("aria-busy", "true");
  });

  it("shows a calm empty state", () => {
    renderTimeline(state());

    expect(screen.getByText("No recorded activity yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Activity timeline" })).toHaveAttribute("aria-busy", "false");
  });

  it("reports an initial failure with retry and no rows", () => {
    const timeline = state({ error: true });
    renderTimeline(timeline);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t load the activity timeline.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(timeline.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText("No recorded activity yet.")).not.toBeInTheDocument();
  });

  it("fails closed on a malformed response with no rows and a retry", () => {
    const timeline = state({ malformed: true, items: [expense()] });
    renderTimeline(timeline);

    expect(screen.getByRole("alert")).toHaveTextContent("could not be verified");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(timeline.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the rows and says so politely when a refresh failed", () => {
    const timeline = state({ items: [expense()], refreshFailed: true });
    renderTimeline(timeline);

    expect(screen.getByRole("status")).toHaveTextContent("could not be refreshed. Showing the records loaded earlier.");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(timeline.refresh).toHaveBeenCalledOnce();
  });

  it("warns, without a status role, that the timeline may be out of date while a write is uncertain", () => {
    renderTimeline(state({ items: [expense()] }), { uncertain: true });

    const notice = screen.getByText(/may be out of date/);
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers older activity only while more pages remain and keeps the button focusable while loading", () => {
    const timeline = state({ items: [expense()], hasMore: true });
    const view = renderTimeline(timeline);

    fireEvent.click(screen.getByRole("button", { name: "Show older activity" }));
    expect(timeline.loadMore).toHaveBeenCalledOnce();

    const loading = state({ items: [expense()], hasMore: true, loadingMore: true, loadMore: timeline.loadMore });
    view.rerenderTimeline(loading);
    const busy = screen.getByRole("button", { name: "Loading older activity…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    fireEvent.click(busy);
    expect(timeline.loadMore).toHaveBeenCalledOnce();
  });

  it("keeps focus on the older-activity button while more pages remain", async () => {
    const timeline = state({ items: [expense()], hasMore: true });
    const view = renderTimeline(timeline);
    const button = screen.getByRole("button", { name: "Show older activity" });
    button.focus();
    fireEvent.click(button);
    view.rerenderTimeline(state({ items: [expense()], hasMore: true, loadingMore: true, loadMore: timeline.loadMore }));

    view.rerenderTimeline(state({
      items: [expense(), expense({ recordId: 2 })], hasMore: true, loadMore: timeline.loadMore,
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Show older activity" })).toHaveFocus());
  });

  it("moves focus to the heading once no older activity remains", async () => {
    const timeline = state({ items: [expense()], hasMore: true });
    const view = renderTimeline(timeline);
    fireEvent.click(screen.getByRole("button", { name: "Show older activity" }));
    view.rerenderTimeline(state({ items: [expense()], hasMore: true, loadingMore: true, loadMore: timeline.loadMore }));

    view.rerenderTimeline(state({ items: [expense(), expense({ recordId: 2 })], hasMore: false }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Activity timeline" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Show older activity" })).not.toBeInTheDocument();
    expect(screen.getByText("That is all of your recorded activity.")).toBeInTheDocument();
  });

  it("explains an older-page failure inline and offers a retry on the same button", async () => {
    const timeline = state({ items: [expense()], hasMore: true });
    const view = renderTimeline(timeline);
    fireEvent.click(screen.getByRole("button", { name: "Show older activity" }));
    view.rerenderTimeline(state({ items: [expense()], hasMore: true, loadMoreFailed: true, loadMore: timeline.loadMore }));

    expect(screen.getByRole("status")).toHaveTextContent("We couldn’t load older activity.");
    const retry = screen.getByRole("button", { name: "Try loading older activity again" });
    await waitFor(() => expect(retry).toHaveFocus());
    fireEvent.click(retry);
    expect(timeline.loadMore).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("renders Spanish labels and keeps user text and exact money unchanged", async () => {
    await i18n.changeLanguage("es");
    renderTimeline(state({ items: [expense(), inflow()], hasMore: true }));

    const region = screen.getByRole("region", { name: "Cronología de actividad" });
    const rows = within(region).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Gasto")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Corner coffee")).toBeInTheDocument();
    expect(within(rows[0]).getByText("−$12.34")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/food/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Entrada de dinero")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Vinculado a un pago de nómina/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("+$2,500.00")).toBeInTheDocument();
    expect(within(rows[0]).getByText((_, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", "2026-09-22");
    expect(screen.getByRole("button", { name: "Mostrar actividad anterior" })).toBeInTheDocument();
  });

  it("renders Spanish for the legacy-amount row and the failure states", async () => {
    await i18n.changeLanguage("es");
    renderTimeline(state({ items: [expense({ amount: "-5.00" })], refreshFailed: true }));

    expect(screen.getByText("El monto requiere revisión")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo actualizar la cronología de actividad");
  });

  it("has no hard-coded English: every visible string comes from a catalog or from the record", () => {
    const jsxText = [...source.matchAll(/>([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)</g)].map((match) => match[1].trim());
    expect(jsxText).toEqual([]);
    expect(source).not.toMatch(/\b(?:aria-label|title|placeholder|alt)="/);
  });
});
