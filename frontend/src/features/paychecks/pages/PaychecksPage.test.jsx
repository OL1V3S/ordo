import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaychecksPage from "./PaychecksPage";
import { paychecksApi } from "../api/paychecksApi";
import { inflowsApi } from "../../inflows/api/inflowsApi";
import { makeCandidate, makeCandidateResponse, makePaycheck, makePaychecksResponse } from "../test/paycheckFixtures";

vi.mock("../api/paychecksApi", () => ({ paychecksApi: {
  getCandidates: vi.fn(), getPaychecks: vi.fn(), confirmCandidate: vi.fn(),
  dismissCandidate: vi.fn(), reconsiderCandidate: vi.fn(), createPaycheck: vi.fn(),
  updatePaycheck: vi.fn(), updateLifecycle: vi.fn(), recordReceipt: vi.fn(), removeReceipt: vi.fn(),
} }));
vi.mock("../../inflows/api/inflowsApi", () => ({ inflowsApi: { getAll: vi.fn() } }));
const response = (data) => ({ data });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const card = (name) => screen.getByRole("heading", { name, exact: true }).closest("article");
const disclosure = (name) => screen.getByLabelText(name).closest("details");
const historyHeading = (name) => screen.getByRole("heading", { level: 2, name: new RegExp(`^${name} \\(\\d+\\)$`) });
const history = (name) => historyHeading(name).closest("details");

function loadState({ candidates = [makeCandidate()], dismissedCandidates = [], paychecks = [makePaycheck()] } = {}) {
  paychecksApi.getCandidates.mockResolvedValue(response(makeCandidateResponse({ candidates, dismissedCandidates })));
  paychecksApi.getPaychecks.mockResolvedValue(response(makePaychecksResponse({ paychecks })));
}
async function renderPage() {
  render(<PaychecksPage />);
  await screen.findByRole("heading", { name: "Your paychecks" });
}
async function fillManual(user, name = "Manual salary") {
  await user.click(screen.getByRole("button", { name: "Add paycheck manually" }));
  const form = screen.getByRole("form", { name: "Create paycheck" });
  await user.type(within(form).getByLabelText("Display name"), name);
  await user.type(within(form).getByLabelText("Monthly anchor day"), "10");
  await user.type(within(form).getByLabelText("Fixed amount"), "2500.00");
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  loadState();
  paychecksApi.confirmCandidate.mockResolvedValue(response({ paycheck: makePaycheck(), alreadyConfirmed: false }));
  paychecksApi.dismissCandidate.mockResolvedValue(response(null));
  paychecksApi.reconsiderCandidate.mockResolvedValue(response(null));
  paychecksApi.createPaycheck.mockResolvedValue(response(makePaycheck({ source: "manual", origin: null, evidence: [] })));
  paychecksApi.updatePaycheck.mockResolvedValue(response(makePaycheck()));
  paychecksApi.updateLifecycle.mockResolvedValue(response(makePaycheck()));
  paychecksApi.recordReceipt.mockResolvedValue(response({ paycheck: makePaycheck(), alreadyRecorded: false }));
  paychecksApi.removeReceipt.mockResolvedValue(response(makePaycheck()));
  inflowsApi.getAll.mockResolvedValue(response([]));
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("Paychecks page", () => {
  it("separates lifecycle/candidate groups, exact evidence and evaluation dates; projects only active profiles", async () => {
    const user = userEvent.setup();
    const active = makePaycheck();
    active.evidence[0].editedSinceConfirmation = true;
    const paused = makePaycheck({ id: "22222222-2222-2222-2222-222222222222", displayName: "Paused pay", lifecycle: "paused" });
    const ended = makePaycheck({ id: "33333333-3333-3333-3333-333333333333", displayName: "Ended pay", lifecycle: "ended", nextProjection: null });
    const dismissed = makeCandidate({ fingerprint: "d".repeat(64), normalizedDescriptionIdentity: "old payroll" });
    loadState({ paychecks: [active, paused, ended], dismissedCandidates: [dismissed] });
    paychecksApi.getCandidates.mockResolvedValue(response(makeCandidateResponse({ evaluatedOn: "2026-07-13", dismissedCandidates: [dismissed] })));
    await renderPage();
    expect(screen.getByRole("group", { name: "Active paychecks" })).toBeInTheDocument();
    expect(history("Paused paychecks")).not.toHaveAttribute("open");
    expect(history("Ended paychecks")).not.toHaveAttribute("open");
    await user.click(historyHeading("Paused paychecks").closest("summary"));
    await user.click(historyHeading("Ended paychecks").closest("summary"));
    expect(history("Dismissed possible paychecks")).not.toHaveAttribute("open");
    await user.click(historyHeading("Dismissed possible paychecks").closest("summary"));
    expect(screen.getByRole("group", { name: "Paused paychecks" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Ended paychecks" })).toBeInTheDocument();
    expect(screen.getAllByText("Expected, not guaranteed.")).toHaveLength(1);
    expect(screen.getByText("Paused paychecks have no active expected window.")).toBeInTheDocument();
    expect(screen.getByText("Ended paychecks have no active expected window.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "old payroll" })).toBeInTheDocument();
    const profile = within(card("Acme Payroll"));
    expect(profile.getByText("Active")).toBeVisible();
    expect(profile.getByText("Expected amount")).toBeVisible();
    expect(profile.getAllByText("$2,500.00").length).toBeGreaterThan(0);
    expect(profile.getByText("Monthly")).toBeVisible();
    expect(profile.getByText("Aug 9, 2026–Aug 11, 2026")).toBeVisible();
    expect(profile.getByRole("button", { name: "Edit Acme Payroll" })).toBeVisible();
    expect(profile.getByRole("button", { name: "Pause Acme Payroll" })).toBeVisible();
    expect(profile.getByText("Confirmed from deposits")).not.toBeVisible();
    expect(disclosure("Details for Acme Payroll")).not.toHaveAttribute("open");
    expect(profile.getByLabelText("Details for Acme Payroll")).toHaveProperty("tabIndex", 0);
    await user.click(profile.getByLabelText("Details for Acme Payroll"));
    expect(profile.getByText("Schedule").closest("div")).toHaveTextContent("Monthly, day 10");
    expect(profile.getByText("Profiles evaluated").closest("div")).toHaveTextContent("Jul 12, 2026");
    expect(profile.getByText("Detection details").closest("div")).toHaveTextContent("paycheck-candidate-v1");
    expect(profile.getByText("Projection details").closest("div")).toHaveTextContent("paycheck-projector-v1");
    expect(profile.getByText("Linked paycheck deposits (3)")).toBeVisible();
    expect(profile.getByText(/Edited since this deposit was linked\. The saved expectation is unchanged/)).toBeVisible();
    expect(profile.getAllByRole("listitem")).toHaveLength(3);
    expect(profile.getByText(/May 10, 2026/, { selector: "time" })).toHaveAttribute("datetime", "2026-05-10");
    const candidate = within(card("acme payroll"));
    expect(candidate.getByText("Observed deposits")).toBeVisible();
    expect(candidate.getByText("Monthly")).toBeVisible();
    expect(candidate.getByText("Based on 3 deposits")).toBeVisible();
    expect(candidate.getByRole("button", { name: "Review and confirm acme payroll" })).toBeVisible();
    expect(candidate.getByRole("button", { name: "Dismiss acme payroll" })).toBeVisible();
    expect(candidate.getByText("Detection details")).not.toBeVisible();
    expect(disclosure("Details for acme payroll")).not.toHaveAttribute("open");
    expect(candidate.getByLabelText("Details for acme payroll")).toHaveProperty("tabIndex", 0);
    await user.click(candidate.getByLabelText("Details for acme payroll"));
    expect(candidate.getByText("Evaluated").closest("div")).toHaveTextContent("Jul 13, 2026");
    expect(candidate.getByText("Deposits to review (3)")).toBeVisible();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("orders active profiles and possible paychecks before closed history disclosures", async () => {
    const activeWithoutProjection = makePaycheck({ nextProjection: null });
    const paused = makePaycheck({ id: "22222222-2222-2222-2222-222222222222", displayName: "Paused pay", lifecycle: "paused", nextProjection: null });
    const ended = makePaycheck({ id: "33333333-3333-3333-3333-333333333333", displayName: "Ended pay", lifecycle: "ended", nextProjection: null });
    const dismissed = makeCandidate({ fingerprint: "d".repeat(64), normalizedDescriptionIdentity: "old payroll" });
    loadState({ paychecks: [activeWithoutProjection, paused, ended], dismissedCandidates: [dismissed] });

    await renderPage();

    const headings = [
      screen.getByRole("heading", { level: 2, name: "Your paychecks" }),
      screen.getByRole("heading", { level: 2, name: "Possible paychecks" }),
      historyHeading("Paused paychecks"),
      historyHeading("Ended paychecks"),
      historyHeading("Dismissed possible paychecks"),
    ];
    for (let index = 0; index < headings.length - 1; index += 1) {
      expect(headings[index].compareDocumentPosition(headings[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const name of ["Paused paychecks", "Ended paychecks", "Dismissed possible paychecks"]) {
      expect(history(name)).not.toHaveAttribute("open");
      expect(historyHeading(name)).toHaveAccessibleName(`${name} (1)`);
      expect(historyHeading(name).closest("summary")).toHaveProperty("tabIndex", 0);
    }
    const profile = within(card("Acme Payroll"));
    expect(profile.getByText("No expected window is available. Expected, not guaranteed.")).toBeVisible();
  });

  it("keeps review drafts outside read-only details across disclosure, theme, and rerender changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PaychecksPage />);
    await screen.findByRole("heading", { name: "Your paychecks" });
    await user.click(screen.getByRole("button", { name: "Review and confirm acme payroll" }));
    const form = screen.getByRole("form", { name: "Confirm paycheck" });
    const name = within(form).getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Draft payroll");
    expect(form.closest("details")).toBeNull();

    const candidateDetails = disclosure("Details for acme payroll");
    await user.click(screen.getByLabelText("Details for acme payroll"));
    expect(candidateDetails).toHaveAttribute("open");
    await user.click(screen.getByLabelText("Details for acme payroll"));
    expect(candidateDetails).not.toHaveAttribute("open");
    document.documentElement.dataset.theme = "dark";
    rerender(<PaychecksPage />);

    expect(screen.getByRole("form", { name: "Confirm paycheck" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Draft payroll");
    expect(disclosure("Details for acme payroll")).not.toHaveAttribute("open");
    document.documentElement.removeAttribute("data-theme");
  });

  it("keeps an inactive edit visible and its history open until the draft is finished", async () => {
    const user = userEvent.setup();
    const paused = makePaycheck({ displayName: "Paused pay", lifecycle: "paused", nextProjection: null });
    loadState({ paychecks: [paused] });
    const { rerender } = render(<PaychecksPage />);
    await screen.findByRole("heading", { name: "Your paychecks" });

    const pausedHistory = history("Paused paychecks");
    const pausedSummary = historyHeading("Paused paychecks").closest("summary");
    await user.click(pausedSummary);
    await user.click(screen.getByRole("button", { name: "Edit Paused pay" }));
    const form = screen.getByRole("form", { name: "Save changes" });
    const profileDetails = disclosure("Details for Paused pay");
    expect(pausedHistory).toHaveAttribute("open");
    expect(pausedSummary).toHaveAttribute("aria-disabled", "true");
    expect(pausedHistory).toContainElement(form);
    expect(profileDetails).not.toContainElement(form);

    await user.clear(within(form).getByLabelText("Display name"));
    await user.type(within(form).getByLabelText("Display name"), "Paused draft");
    await user.click(pausedSummary);
    expect(pausedHistory).toHaveAttribute("open");
    document.documentElement.dataset.theme = "light";
    rerender(<PaychecksPage />);
    expect(screen.getByRole("form", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Paused draft");
    expect(history("Paused paychecks")).toHaveAttribute("open");
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows initial loading and durable load error, then retries to intentional empty states", async () => {
    const pending = deferred();
    paychecksApi.getCandidates.mockReturnValue(pending.promise);
    render(<PaychecksPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading paychecks");
    await act(async () => pending.reject(new Error("offline")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paychecks could not be loaded");
    loadState({ candidates: [], dismissedCandidates: [], paychecks: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh paychecks" }));
    expect(await screen.findByText("No paycheck profiles yet")).toBeInTheDocument();
    expect(screen.getByText(/No possible paychecks need review/)).toBeInTheDocument();
    expect(screen.getByText("No dismissed possible paychecks.")).toBeInTheDocument();
  });

  it.each([true, false])("handles the candidates/profiles-only empty combination (candidates=%s)", async (candidatesOnly) => {
    loadState({ candidates: candidatesOnly ? [makeCandidate()] : [], paychecks: candidatesOnly ? [] : [makePaycheck()] });
    await renderPage();
    expect(Boolean(screen.queryByText("No paycheck profiles yet"))).toBe(candidatesOnly);
    expect(Boolean(screen.queryByText(/No possible paychecks need review/))).toBe(!candidatesOnly);
  });

  it("requires explicit fixed confirmation and sends the exact candidate schedule and accepted decimal", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(card("acme payroll")).getByRole("button", { name: "Review and confirm acme payroll" }));
    const form = within(screen.getByRole("form", { name: "Confirm paycheck" }));
    expect(form.queryByLabelText("Cadence")).not.toBeInTheDocument();
    expect(form.getByText("Monthly, day 10")).toBeInTheDocument();
    await user.clear(form.getByLabelText("Display name"));
    await user.type(form.getByLabelText("Display name"), "Acme salary");
    await user.clear(form.getByLabelText("Fixed amount"));
    await user.type(form.getByLabelText("Fixed amount"), "2500.10");
    loadState({ candidates: [], paychecks: [makePaycheck({ displayName: "Acme salary" })] });
    await user.click(form.getByRole("button", { name: "Confirm paycheck" }));
    expect(paychecksApi.confirmCandidate).toHaveBeenCalledExactlyOnceWith({
      algorithmVersion: "paycheck-candidate-v1", fingerprint: makeCandidate().fingerprint,
      displayName: "Acme salary", schedule: makeCandidate().schedule, windowBeforeDays: 1, windowAfterDays: 1,
      amount: { mode: "fixed", fixedAmount: "2500.10", minimumAmount: null, maximumAmount: null },
    });
    expect(await screen.findByRole("heading", { name: "Acme salary" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your paychecks" })).toHaveFocus());
  });

  it("requires typed bounds for variable candidates and refreshes exact dismissal/reconsideration decisions", async () => {
    const user = userEvent.setup();
    const variable = makeCandidate({ fingerprint: "c".repeat(64), observedAmount: { mode: "variable", fixedAmount: null, minimumAmount: 1800, maximumAmount: 2600, lowerMedianAmount: 2100 } });
    const other = makeCandidate({ fingerprint: "d".repeat(64), normalizedDescriptionIdentity: "other payroll" });
    loadState({ candidates: [variable, other], paychecks: [] });
    await renderPage();
    const variableCard = within(card("acme payroll"));
    expect(variableCard.getByText(/Observed history, not an expected range/)).toBeVisible();
    await user.click(variableCard.getByRole("button", { name: "Review and confirm acme payroll" }));
    const form = within(screen.getByRole("form", { name: "Confirm paycheck" }));
    expect(form.getByLabelText("Minimum amount")).toHaveValue("");
    expect(form.getByLabelText("Maximum amount")).toHaveValue("");
    await user.click(form.getByRole("button", { name: "Confirm paycheck" }));
    expect(paychecksApi.confirmCandidate).not.toHaveBeenCalled();
    expect(form.getByRole("alert")).toHaveTextContent("Check the highlighted fields");
    await user.type(form.getByLabelText("Minimum amount"), "1800.00");
    await user.type(form.getByLabelText("Maximum amount"), "2600.25");
    loadState({ candidates: [other] });
    await user.click(form.getByRole("button", { name: "Confirm paycheck" }));
    expect(paychecksApi.confirmCandidate).toHaveBeenCalledWith(expect.objectContaining({ amount: { mode: "range", fixedAmount: null, minimumAmount: "1800.00", maximumAmount: "2600.25" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss other payroll" })).toBeEnabled());
    loadState({ candidates: [], dismissedCandidates: [other] });
    await user.click(screen.getByRole("button", { name: "Dismiss other payroll" }));
    await screen.findByRole("button", { name: "Reconsider other payroll" });
    expect(history("Dismissed possible paychecks")).toHaveAttribute("open");
    await waitFor(() => expect(historyHeading("Dismissed possible paychecks").closest("summary")).toHaveFocus());
    const tuple = { algorithmVersion: other.algorithmVersion, cadence: "monthly", fingerprint: other.fingerprint };
    expect(paychecksApi.dismissCandidate).toHaveBeenCalledExactlyOnceWith(tuple);
    loadState({ candidates: [other] });
    await user.click(screen.getByRole("button", { name: "Reconsider other payroll" }));
    expect(paychecksApi.reconsiderCandidate).toHaveBeenCalledExactlyOnceWith(tuple);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Possible paychecks" })).toHaveFocus());
  });

  it("keeps a known manual creation successful when refresh fails, without offering repeat submission", async () => {
    const user = userEvent.setup();
    await renderPage();
    const form = await fillManual(user);
    paychecksApi.getCandidates.mockRejectedValue(new Error("refresh failed"));
    await user.click(within(form).getByRole("button", { name: "Create paycheck" }));
    expect(paychecksApi.createPaycheck).toHaveBeenCalledExactlyOnceWith({
      displayName: "Manual salary", schedule: makeCandidate().schedule, windowBeforeDays: 0, windowAfterDays: 0,
      amount: { mode: "fixed", fixedAmount: "2500.00", minimumAmount: null, maximumAmount: null },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Paychecks could not be loaded");
    expect(screen.getByRole("status")).toHaveTextContent("Paycheck created");
    expect(screen.queryByRole("form", { name: "Create paycheck" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add paycheck manually" })).toBeDisabled();
  });

  it("disables conflicting actions while saving and protects an uncertain manual result until checked", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    paychecksApi.createPaycheck.mockReturnValue(pending.promise);
    await renderPage();
    const form = await fillManual(user);
    await user.click(within(form).getByRole("button", { name: "Create paycheck" }));
    expect(screen.getByText("Saving your decision…").closest("details")).toBeNull();
    expect(form.closest("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss acme payroll" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Acme Payroll" })).toBeDisabled();
    await act(async () => pending.reject(new Error("network lost")));
    const uncertain = await screen.findByRole("alert");
    expect(uncertain).toHaveTextContent("could not confirm whether the paycheck was created");
    expect(uncertain.closest("details")).toBeNull();
    expect(within(form).getByRole("button", { name: "Create paycheck" })).toBeDisabled();
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Refresh paychecks" }));
    await waitFor(() => expect(within(form).getByRole("button", { name: "Create paycheck" })).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("Check the saved profiles");
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
  });

  it("records actual cash in for a server-provided slot with exact mismatch warnings", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Record received Acme Payroll" }));
    const panel = screen.getByRole("region", { name: "Record received paycheck for Acme Payroll" });
    const form = within(panel).getByRole("form", { name: "Add cash in" });
    expect(within(form).getByLabelText("Description")).toHaveValue("Acme Payroll");
    expect(within(form).getByLabelText("Amount")).toHaveValue("2500");
    await user.clear(within(form).getByLabelText("Amount"));
    await user.type(within(form).getByLabelText("Amount"), "2600.25");
    await user.clear(within(form).getByLabelText("Date"));
    await user.type(within(form).getByLabelText("Date"), "2026-08-15");
    expect(within(panel).getByText(/Amount differs from the fixed expectation/)).toBeVisible();
    expect(within(panel).getByText(/Date is outside this paycheck's expected window/)).toBeVisible();
    loadState({ paychecks: [makePaycheck({ receiptSlots: [] })] });
    await user.click(within(form).getByRole("button", { name: "Add cash in" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, {
      slotAnchor: "2026-08-10",
      newInflow: { description: "Acme Payroll", amount: "2600.25", date: "2026-08-15" },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Paycheck received");
  });

  it("preserves the exact receipt draft and slot after an uncertain result is checked", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    paychecksApi.recordReceipt.mockRejectedValueOnce(new Error("response lost"));
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Record received Acme Payroll" }));
    const panel = screen.getByRole("region", { name: "Record received paycheck for Acme Payroll" });
    const form = within(panel).getByRole("form", { name: "Add cash in" });
    await user.clear(within(form).getByLabelText("Date"));
    await user.type(within(form).getByLabelText("Date"), "2026-08-10");
    await user.click(within(form).getByRole("button", { name: "Add cash in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm the outcome");
    expect(within(form).getByRole("button", { name: "Add cash in" })).toBeDisabled();

    loadState({ paychecks: [makePaycheck({ receiptSlots: [] })] });
    await user.click(screen.getByRole("button", { name: "Refresh paychecks" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Check the linked deposits");
    expect(within(panel).getByRole("combobox", { name: "Expected paycheck date" })).toHaveValue("2026-08-10");
    expect(within(panel).getByRole("option", { name: /previously selected/ })).toBeInTheDocument();
    expect(within(form).getByLabelText("Date")).toHaveValue("2026-08-10");
    expect(within(form).getByRole("button", { name: "Add cash in" })).toBeEnabled();

    await user.click(within(form).getByRole("button", { name: "Add cash in" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledTimes(2);
    expect(paychecksApi.recordReceipt).toHaveBeenNthCalledWith(2, profile.id, {
      slotAnchor: "2026-08-10",
      newInflow: { description: "Acme Payroll", amount: "2500", date: "2026-08-10" },
    });
  });

  it("lazily selects an unlinked existing inflow and preserves server ordering", async () => {
    const user = userEvent.setup();
    const profile = makePaycheck();
    inflowsApi.getAll.mockResolvedValue(response([
      { id: 201, description: "First available", amount: 2400, date: "2026-08-10" },
      { id: 101, description: "Already linked", amount: 2500, date: "2026-05-10" },
      { id: 202, description: "Second available", amount: 2600, date: "2026-08-12" },
    ]));
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Record received Acme Payroll" }));
    await user.click(screen.getByRole("radio", { name: "Use existing cash in" }));
    expect(await screen.findByRole("radio", { name: /First available/ })).toBeInTheDocument();
    expect(screen.queryByText("Already linked")).not.toBeInTheDocument();
    const choices = screen.getAllByRole("radio", { name: /available/ });
    expect(choices.map((choice) => choice.value)).toEqual(["201", "202"]);
    await user.click(choices[0]);
    expect(screen.getByText(/Amount differs from the fixed expectation/)).toBeVisible();
    loadState({ paychecks: [makePaycheck({ receiptSlots: [] })] });
    await user.click(screen.getByRole("button", { name: "Link cash in" }));
    expect(paychecksApi.recordReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, {
      slotAnchor: "2026-08-10", existingInflowId: 201,
    });
    expect(inflowsApi.getAll).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation before removing only a recorded-receipt link", async () => {
    const user = userEvent.setup();
    const evidence = makePaycheck().evidence;
    const receipt = { ...evidence[0], assignmentKind: "recorded_receipt", accountInflowId: 301, description: "Actual payroll" };
    const profile = makePaycheck({ evidence: [evidence[1], receipt] });
    loadState({ paychecks: [profile] });
    await renderPage();
    await user.click(screen.getByLabelText("Details for Acme Payroll"));
    expect(screen.getByText("Confirmation history")).toBeVisible();
    expect(screen.getByText("Received paycheck")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove paycheck link" }));
    expect(paychecksApi.removeReceipt).not.toHaveBeenCalled();
    expect(screen.getByText(/cash-in record will remain in Activity/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm removal" })).toHaveFocus();
    loadState({ paychecks: [makePaycheck({ evidence: [evidence[1]] })] });
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(paychecksApi.removeReceipt).toHaveBeenCalledExactlyOnceWith(profile.id, 301);
  });

  it("closes a stale review with a visible conflict and requires explicit review of replacement evidence", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Review and confirm acme payroll" }));
    paychecksApi.confirmCandidate.mockRejectedValue({ response: { status: 409, data: { code: "candidate_changed" } } });
    loadState({ candidates: [makeCandidate({ fingerprint: "e".repeat(64) })] });
    await user.click(screen.getByRole("button", { name: "Confirm paycheck" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Review the latest evidence");
    await waitFor(() => expect(screen.queryByRole("form", { name: "Confirm paycheck" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeEnabled();
    expect(paychecksApi.confirmCandidate).toHaveBeenCalledTimes(1);
  });

  it("pauses an ended profile from Details and opens the paused destination history", async () => {
    const user = userEvent.setup();
    const ended = makePaycheck({ displayName: "Ended pay", lifecycle: "ended", nextProjection: null });
    loadState({ paychecks: [ended] });
    await renderPage();

    expect(historyHeading("Ended paychecks")).toHaveAccessibleName("Ended paychecks (1)");
    expect(history("Ended paychecks")).not.toHaveAttribute("open");
    await user.click(historyHeading("Ended paychecks").closest("summary"));
    await user.click(screen.getByLabelText("Details for Ended pay"));
    const endedCard = within(card("Ended pay"));
    expect(endedCard.getByText("Detection details").closest("div")).toHaveTextContent("paycheck-candidate-v1");

    loadState({ paychecks: [{ ...ended, lifecycle: "paused" }] });
    await user.click(endedCard.getByRole("button", { name: "Pause Ended pay" }));

    expect(paychecksApi.updateLifecycle).toHaveBeenCalledExactlyOnceWith(ended.id, "paused");
    expect(await screen.findByRole("group", { name: "Paused paychecks" })).toHaveTextContent("Ended pay");
    expect(history("Paused paychecks")).toHaveAttribute("open");
  });

  it.each([
    ["no longer includes the profile", [], null],
    ["shows the profile already ended", [makePaycheck({ lifecycle: "ended", nextProjection: null })], "Ended paychecks (1)"],
    ["shows the profile now paused", [makePaycheck({ lifecycle: "paused", nextProjection: null })], "Paused paychecks (1)"],
  ])("clears an orphaned end confirmation when the refresh %s", async (_state, refreshedPaychecks, destinationHeading) => {
    const user = userEvent.setup();
    const active = makePaycheck();
    loadState({ paychecks: [active] });
    await renderPage();
    await user.click(screen.getByLabelText("Details for Acme Payroll"));
    await user.click(screen.getByRole("button", { name: "End Acme Payroll" }));
    expect(screen.getByRole("button", { name: "Confirm end" })).toHaveFocus();

    paychecksApi.updateLifecycle.mockRejectedValueOnce({ response: { status: 404, data: { code: "paycheck_not_found" } } });
    loadState({ paychecks: refreshedPaychecks });
    await user.click(screen.getByRole("button", { name: "Confirm end" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That paycheck is no longer available. Review the current profiles.");
    expect(alert.closest("details")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("group", { name: "End Acme Payroll" })).not.toBeInTheDocument());
    expect(paychecksApi.updateLifecycle).toHaveBeenCalledExactlyOnceWith(active.id, "ended");
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add paycheck manually" })).toBeEnabled();
    if (destinationHeading) expect(screen.getByRole("heading", { level: 2, name: destinationHeading })).toBeInTheDocument();
    else {
      expect(screen.queryByRole("heading", { level: 2, name: "Ended paychecks (1)" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2, name: "Paused paychecks (1)" })).not.toBeInTheDocument();
    }
  });

  it("retains end confirmation when a stale refresh keeps the same profile card", async () => {
    const user = userEvent.setup();
    const active = makePaycheck();
    loadState({ paychecks: [active] });
    await renderPage();
    await user.click(screen.getByLabelText("Details for Acme Payroll"));
    await user.click(screen.getByRole("button", { name: "End Acme Payroll" }));

    paychecksApi.updateLifecycle.mockRejectedValueOnce({ response: { status: 404, data: { code: "paycheck_not_found" } } });
    loadState({ paychecks: [active] });
    await user.click(screen.getByRole("button", { name: "Confirm end" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That paycheck is no longer available. Review the current profiles.");
    expect(screen.getByRole("group", { name: "End Acme Payroll" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel ending" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add paycheck manually" })).toBeDisabled();
  });

  it("retains end confirmation and task locks when its stale-state refresh fails", async () => {
    const user = userEvent.setup();
    const active = makePaycheck();
    loadState({ paychecks: [active] });
    await renderPage();
    await user.click(screen.getByLabelText("Details for Acme Payroll"));
    await user.click(screen.getByRole("button", { name: "End Acme Payroll" }));

    paychecksApi.updateLifecycle.mockRejectedValueOnce({ response: { status: 404, data: { code: "paycheck_not_found" } } });
    paychecksApi.getCandidates.mockRejectedValueOnce(new Error("refresh failed"));
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("refresh failed"));
    await user.click(screen.getByRole("button", { name: "Confirm end" }));

    const errors = await screen.findAllByRole("alert");
    expect(errors.map((alert) => alert.textContent).join(" ")).toContain("That paycheck is no longer available. Review the current profiles.");
    expect(errors.map((alert) => alert.textContent).join(" ")).toContain("Paychecks could not be loaded");
    errors.forEach((alert) => expect(alert.closest("details")).toBeNull());
    expect(screen.getByRole("group", { name: "End Acme Payroll" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel ending" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh paychecks" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add paycheck manually" })).toBeDisabled();

    loadState({ paychecks: [active] });
    await user.click(screen.getByRole("button", { name: "Refresh paychecks" }));
    expect(screen.getByRole("group", { name: "End Acme Payroll" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel ending" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "End Acme Payroll" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Review and confirm acme payroll" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add paycheck manually" })).toBeEnabled();
  });

  it("preserves edit restrictions and restores focus for cancel, then moves profiles through lifecycle groups", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole("button", { name: "Edit Acme Payroll" }));
    expect(screen.getByLabelText("Display name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Acme Payroll" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Edit Acme Payroll" }));
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), "Renamed payroll");
    const profile = makePaycheck({ displayName: "Renamed payroll" });
    loadState({ paychecks: [profile] });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(paychecksApi.updatePaycheck).toHaveBeenCalledExactlyOnceWith(profile.id, {
      displayName: "Renamed payroll", windowBeforeDays: 1, windowAfterDays: 1,
      amount: { mode: "fixed", fixedAmount: "2500", minimumAmount: null, maximumAmount: null },
    });
    await screen.findByRole("button", { name: "Pause Renamed payroll" });
    loadState({ paychecks: [{ ...profile, lifecycle: "paused", nextProjection: null }] });
    await user.click(screen.getByRole("button", { name: "Pause Renamed payroll" }));
    const pausedGroup = await screen.findByRole("group", { name: "Paused paychecks" });
    expect(pausedGroup).toHaveTextContent("Renamed payroll");
    const pausedHistory = history("Paused paychecks");
    const pausedSummary = historyHeading("Paused paychecks").closest("summary");
    expect(pausedHistory).toHaveAttribute("open");
    expect(paychecksApi.updateLifecycle).toHaveBeenLastCalledWith(profile.id, "paused");
    await user.click(screen.getByLabelText("Details for Renamed payroll"));
    const profileDetails = disclosure("Details for Renamed payroll");
    await user.click(screen.getByRole("button", { name: "End Renamed payroll" }));
    const confirmEnd = screen.getByRole("button", { name: "Confirm end" });
    expect(confirmEnd).toHaveFocus();
    expect(profileDetails).not.toContainElement(confirmEnd);
    expect(pausedHistory).toContainElement(confirmEnd);
    expect(pausedSummary).toHaveAttribute("aria-disabled", "true");
    await user.click(pausedSummary);
    expect(pausedHistory).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "Cancel ending" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "End Renamed payroll" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "End Renamed payroll" }));
    loadState({ paychecks: [{ ...profile, lifecycle: "ended", nextProjection: null }] });
    await user.click(screen.getByRole("button", { name: "Confirm end" }));
    expect(await screen.findByRole("group", { name: "Ended paychecks" })).toHaveTextContent("Renamed payroll");
    expect(paychecksApi.updateLifecycle).toHaveBeenLastCalledWith(profile.id, "ended");
    loadState({ paychecks: [profile] });
    await user.click(screen.getByRole("button", { name: "Reactivate Renamed payroll" }));
    expect(await screen.findByRole("group", { name: "Active paychecks" })).toHaveTextContent("Renamed payroll");
    expect(paychecksApi.updateLifecycle).toHaveBeenLastCalledWith(profile.id, "active");
  });

  it("does not let delayed lifecycle focus steal focus from an immediate end confirmation", async () => {
    const user = userEvent.setup();
    const frames = [];
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    try {
      const profile = makePaycheck();
      await renderPage();
      loadState({ paychecks: [{ ...profile, lifecycle: "paused", nextProjection: null }] });
      await user.click(screen.getByRole("button", { name: "Pause Acme Payroll" }));
      await screen.findByRole("group", { name: "Paused paychecks" });
      await user.click(screen.getByLabelText("Details for Acme Payroll"));
      await user.click(screen.getByRole("button", { name: "End Acme Payroll" }));
      const confirmation = screen.getByRole("button", { name: "Confirm end" });
      expect(confirmation).toHaveFocus();

      act(() => {
        frames.splice(0).forEach((callback) => callback(performance.now()));
      });
      expect(confirmation).toHaveFocus();
    } finally {
      animationFrame.mockRestore();
    }
  });
});
