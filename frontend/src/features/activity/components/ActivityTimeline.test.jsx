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
    expect(notice.parentElement).toHaveAttribute("aria-live", "polite");
    expect(notice).not.toHaveAttribute("role");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps one polite live container mounted before the uncertain-write notice appears", () => {
    const timeline = state({ items: [expense()] });
    const view = renderTimeline(timeline);

    const liveRegions = view.container.querySelectorAll("[aria-live]");
    expect(liveRegions).toHaveLength(1);
    const live = liveRegions[0];
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();

    view.rerenderTimeline(timeline, { uncertain: true });
    expect(view.container.querySelector("[aria-live]")).toBe(live);
    expect(live).toHaveTextContent(/may be out of date/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    view.rerenderTimeline(timeline, { uncertain: false });
    expect(view.container.querySelector("[aria-live]")).toBe(live);
    expect(live).toBeEmptyDOMElement();
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

  describe("filters", () => {
    const emptyFilter = { q: "", kind: "", from: "", to: "" };
    const filtersOf = (overrides = {}) => ({
      draft: { ...emptyFilter }, applied: { ...emptyFilter }, error: null, active: false,
      period: "all", presetRange: null, setField: vi.fn(), setPeriod: vi.fn(), removeField: vi.fn(), clear: vi.fn(), ...overrides,
    });

    it("renders no controls without a filters prop", () => {
      renderTimeline(state());
      expect(screen.queryByLabelText("Search activity")).not.toBeInTheDocument();
    });

    it("keeps search visible and Type/period behind a Filters disclosure", () => {
      const filters = filtersOf({ period: "custom" });
      renderTimeline(state(), { filters });
      const toggle = screen.getByRole("button", { name: "Filters" });
      expect(screen.getByLabelText("Search activity")).toBeVisible();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAttribute("aria-controls", "activity-timeline-filter-panel");
      expect(document.getElementById("activity-timeline-filter-panel")).not.toBeVisible();
      expect(screen.getByLabelText("Type")).not.toBeVisible();

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(document.getElementById("activity-timeline-filter-panel")).toBeVisible();

      fireEvent.change(screen.getByLabelText("Search activity"), { target: { value: "cof" } });
      fireEvent.change(screen.getByLabelText("Type"), { target: { value: "expense" } });
      fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-01" } });
      fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-09-30" } });

      expect(filters.setField.mock.calls).toEqual([
        ["q", "cof"], ["kind", "expense"], ["from", "2026-09-01"], ["to", "2026-09-30"]]);
      expect(within(screen.getByLabelText("Type")).getAllByRole("option").map((option) => option.textContent))
        .toEqual(["All activity", "Expense", "Cash in"]);
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("offers single-select period chips and hides the dates unless Custom", () => {
      const filters = filtersOf({ period: "last7" });
      renderTimeline(state(), { filters });
      fireEvent.click(screen.getByRole("button", { name: "Filters" }));
      const group = screen.getByRole("group", { name: "Period" });
      const pressed = within(group).getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");
      expect(pressed.map((button) => button.textContent)).toEqual(["Last 7 days"]);
      expect(screen.queryByLabelText("From date")).not.toBeInTheDocument();
      fireEvent.click(within(group).getByRole("button", { name: "This month" }));
      expect(filters.setPeriod).toHaveBeenCalledWith("thisMonth");
    });

    it("renders removable chips from the applied filter, and a preset collapses from/to into one chip", () => {
      const applied = { q: "coffee", kind: "expense", from: "2026-09-01", to: "2026-09-30" };
      const filters = filtersOf({ draft: applied, applied, active: true, period: "thisMonth", presetRange: { from: "2026-09-01", to: "2026-09-30" } });
      renderTimeline(state({ appliedFilter: applied }), { filters });

      const group = screen.getByRole("group", { name: "Active filters" });
      expect(within(group).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
        "Remove filter: Search: “coffee”", "Remove filter: Expense", "Remove filter: This month", null]);
      fireEvent.click(within(group).getByRole("button", { name: "Remove filter: This month" }));
      expect(filters.removeField).toHaveBeenCalledWith("period");
    });

    it("shows From/Through chips for custom dates", () => {
      const applied = { q: "", kind: "", from: "2026-09-01", to: "2026-09-30" };
      const filters = filtersOf({ draft: applied, applied, active: true, period: "custom" });
      renderTimeline(state({ appliedFilter: applied }), { filters });
      fireEvent.click(screen.getByRole("button", { name: "Remove filter: Through 2026-09-30" }));
      expect(filters.removeField).toHaveBeenCalledWith("to");
      expect(screen.getByRole("button", { name: "Remove filter: From 2026-09-01" })).toBeVisible();
    });

    it("moves focus to the next chip, else the previous, else search after a removal", () => {
      const applied = { q: "coffee", kind: "expense", from: "", to: "" };
      const state1 = filtersOf({ draft: applied, applied, active: true });
      let current = state1;
      state1.removeField = vi.fn();
      const { rerenderTimeline } = renderTimeline(state(), { filters: current });
      fireEvent.click(screen.getByRole("button", { name: /Remove filter: Search/ }));
      const kindOnly = { ...applied, q: "" };
      current = filtersOf({ draft: kindOnly, applied: kindOnly, active: true });
      rerenderTimeline(state(), { filters: current });
      expect(screen.getByRole("button", { name: "Remove filter: Expense" })).toHaveFocus();

      fireEvent.click(screen.getByRole("button", { name: "Remove filter: Expense" }));
      const none = { q: "", kind: "", from: "", to: "" };
      rerenderTimeline(state(), { filters: filtersOf({ draft: none, applied: none }) });
      expect(screen.getByLabelText("Search activity")).toHaveFocus();
    });

    it("shows a polite active-filter summary and a working clear button", () => {
      const applied = { q: "coffee", kind: "expense", from: "2026-09-01", to: "" };
      const filters = filtersOf({ draft: applied, applied, active: true });
      renderTimeline(state({ appliedFilter: applied }), { filters });

      const summary = screen.getByText(/Search: “coffee” · Expense · From 2026-09-01/);
      expect(summary.closest("[aria-live='polite']")).not.toBeNull();
      expect(summary).toHaveClass("sr-only");
      expect(summary).toHaveTextContent(/^Active filters:/);
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(filters.clear).toHaveBeenCalledTimes(1);
    });

    it("moves focus to the search field when clearing removes the clear button", () => {
      const applied = { q: "coffee", kind: "", from: "", to: "" };
      renderTimeline(state({ appliedFilter: applied }), { filters: filtersOf({ draft: applied, applied, active: true }) });

      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(screen.getByLabelText("Search activity")).toHaveFocus();
    });

    it("explains invalid filters in the live region and opens the panel so the field is visible", () => {
      renderTimeline(state(), { filters: filtersOf({ error: "range", active: true, period: "custom" }) });

      expect(screen.getByText(/Check the filters/).closest("[aria-live='polite']")).not.toBeNull();
      const toggle = screen.getByRole("button", { name: "Filters" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByLabelText("From date")).toBeVisible();
      expect(screen.getByLabelText("From date")).toHaveAttribute("aria-invalid", "true");
    });

    it("distinguishes no matches under a filter from no recorded activity", () => {
      const applied = { q: "zzz", kind: "", from: "", to: "" };
      const { rerenderTimeline } = renderTimeline(state({ appliedFilter: emptyFilter }));
      expect(screen.getByText("No recorded activity yet.")).toBeInTheDocument();

      rerenderTimeline(state({ appliedFilter: applied }), { filters: filtersOf({ applied, draft: applied, active: true }) });
      expect(screen.getByText("No activity matches these filters.")).toBeInTheDocument();
      expect(screen.queryByText("No recorded activity yet.")).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ (results|matches)/i)).not.toBeInTheDocument();
    });

    it("chooses the empty message from the committed filter, not the draft", () => {
      const draft = { ...emptyFilter, q: "typing" };
      renderTimeline(state({ appliedFilter: emptyFilter }), { filters: filtersOf({ draft, active: true }) });

      expect(screen.getByText("No recorded activity yet.")).toBeInTheDocument();
    });

    it("renders the controls in Spanish", async () => {
      await i18n.changeLanguage("es");
      const applied = { q: "caf", kind: "", from: "", to: "2026-09-30" };
      renderTimeline(state({ appliedFilter: applied }), { filters: filtersOf({ applied, draft: applied, active: true, period: "custom" }) });

      expect(screen.getByLabelText("Buscar actividad")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
      expect(screen.getByLabelText("Tipo")).toBeVisible();
      expect(screen.getByLabelText("Desde")).toBeVisible();
      expect(screen.getByLabelText("Hasta")).toBeVisible();
      expect(screen.getByRole("button", { name: "Borrar filtros" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Quitar filtro: Hasta 2026-09-30" })).toBeVisible();
      expect(screen.getByText(/Búsqueda: “caf” · Hasta 2026-09-30/)).toBeInTheDocument();
      expect(screen.getByText("Ninguna actividad coincide con estos filtros.")).toBeInTheDocument();
    });
  });

  describe("row actions", () => {
    const actions = (getState = () => ({ canEdit: true, canDelete: true })) => ({ getState, onEdit: vi.fn(), onDelete: vi.fn() });

    it("renders no actions without rowActions", () => {
      renderTimeline(state({ items: [expense(), inflow()] }));
      expect(screen.queryByRole("button", { name: /^(Edit|Delete)/ })).not.toBeInTheDocument();
    });

    it("names each action by type, record and date, even when an expense and a cash in share an id", () => {
      renderTimeline(state({ items: [expense({ recordId: 3 }), inflow({ recordId: 3 })] }), { rowActions: actions() });
      expect(screen.getByRole("button", { name: "Edit expense Corner coffee from Sep 22, 2026, record 3" })).toHaveTextContent("Edit");
      expect(screen.getByRole("button", { name: "Delete expense Corner coffee from Sep 22, 2026, record 3" })).toHaveClass("button-danger");
      expect(screen.getByRole("button", { name: "Edit cash in Payroll deposit from Sep 21, 2026, record 3" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete cash in Payroll deposit from Sep 21, 2026, record 3" })).toHaveClass("button-ghost");
    });

    it("applies getState per row, keeping Delete enabled for an amount that needs review", () => {
      const rowActions = actions((item) => item.kind === "expense" ? { canEdit: false, canDelete: true } : { canEdit: false, canDelete: false });
      renderTimeline(state({ items: [expense({ amount: "-5.00" }), inflow()] }), { rowActions });
      expect(screen.getByRole("button", { name: /^Edit expense/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Delete expense/ })).toBeEnabled();
      expect(screen.getByRole("button", { name: /^Edit cash in/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Delete cash in/ })).toBeDisabled();
    });

    it("passes the item and the clicked button to the handlers", () => {
      const rowActions = actions();
      const item = inflow({ recordId: 9 });
      renderTimeline(state({ items: [item] }), { rowActions });
      const edit = screen.getByRole("button", { name: /^Edit cash in/ });
      fireEvent.click(edit);
      fireEvent.click(screen.getByRole("button", { name: /^Delete cash in/ }));
      expect(rowActions.onEdit).toHaveBeenCalledWith(item, edit);
      expect(rowActions.onDelete).toHaveBeenCalledWith(item, screen.getByRole("button", { name: /^Delete cash in/ }));
    });

    it("localizes the action names in Spanish", async () => {
      await i18n.changeLanguage("es");
      renderTimeline(state({ items: [expense({ recordId: 3 })] }), { rowActions: actions() });
      expect(screen.getByRole("button", { name: /^Editar gasto Corner coffee del .*, registro 3$/ })).toHaveTextContent("Editar");
      expect(screen.getByRole("button", { name: /^Eliminar gasto/ })).toHaveTextContent("Eliminar");
    });
  });
});
