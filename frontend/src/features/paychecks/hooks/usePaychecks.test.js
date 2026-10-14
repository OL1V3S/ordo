import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../shared/localization/i18n";
import { inflowsApi } from "../../inflows/api/inflowsApi";
import { paychecksApi } from "../api/paychecksApi";
import { getPaycheckErrorMessage, usePaychecks } from "./usePaychecks";

vi.mock("../api/paychecksApi", () => ({ paychecksApi: {
  getCandidates: vi.fn(), getPaychecks: vi.fn(), getPaycheck: vi.fn(), confirmCandidate: vi.fn(),
  dismissCandidate: vi.fn(), reconsiderCandidate: vi.fn(), createPaycheck: vi.fn(),
  updatePaycheck: vi.fn(), updateLifecycle: vi.fn(), recordReceipt: vi.fn(), removeReceipt: vi.fn(),
} }));

vi.mock("../../inflows/api/inflowsApi", () => ({ inflowsApi: { getAll: vi.fn() } }));

const candidateData = {
  evaluatedOn: "2026-09-05", candidates: [{ fingerprint: "z" }, { fingerprint: "a" }],
  dismissedCandidates: [{ fingerprint: "dismissed" }],
};
const profileData = { evaluatedOn: "2026-09-06", paychecks: [{ id: "z" }, { id: "a" }] };
const tuple = { algorithmVersion: "paycheck-candidate-v1", cadence: "monthly", fingerprint: "z" };
const payload = { displayName: "Synthetic paycheck", ...tuple };
const serverError = (status, code) => ({ response: { status, data: { code, detail: "PRIVATE SERVER DATA" } } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function ready() {
  const hook = renderHook(() => usePaychecks());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("paycheck state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    paychecksApi.getCandidates.mockResolvedValue({ data: candidateData });
    paychecksApi.getPaychecks.mockResolvedValue({ data: profileData });
    inflowsApi.getAll.mockResolvedValue({ data: [{ id: 1 }] });
    for (const method of ["confirmCandidate", "dismissCandidate", "reconsiderCandidate", "createPaycheck", "updatePaycheck", "updateLifecycle", "recordReceipt", "removeReceipt"])
      paychecksApi[method].mockResolvedValue({ data: { id: "saved" } });
  });

  it("loads both resource envelopes, preserves server order and keeps their distinct evaluation dates", async () => {
    const { result } = await ready();
    expect(result.current.candidates).toEqual(candidateData.candidates);
    expect(result.current.dismissedCandidates).toEqual(candidateData.dismissedCandidates);
    expect(result.current.paychecks).toEqual(profileData.paychecks);
    expect(result.current.candidatesEvaluatedOn).toBe("2026-09-05");
    expect(result.current.paychecksEvaluatedOn).toBe("2026-09-06");
    expect(result.current.loadError).toBeNull();
  });

  it.each([
    [[], [], []], [[{ fingerprint: "x" }], [], []], [[], [{ fingerprint: "x" }], []], [[], [], [{ id: "x" }]],
  ])("retains empty combinations independently", async (candidates, dismissedCandidates, paychecks) => {
    paychecksApi.getCandidates.mockResolvedValue({ data: { evaluatedOn: "2026-09-05", candidates, dismissedCandidates } });
    paychecksApi.getPaychecks.mockResolvedValue({ data: { evaluatedOn: "2026-09-05", paychecks } });
    const { result } = await ready();
    expect([result.current.candidates, result.current.dismissedCandidates, result.current.paychecks]).toEqual([candidates, dismissedCandidates, paychecks]);
  });

  it("distinguishes initial loading from read-only refreshing and keeps rendered data during refresh", async () => {
    const { result } = await ready();
    const next = deferred();
    paychecksApi.getCandidates.mockReturnValueOnce(next.promise);
    let refresh;
    act(() => { refresh = result.current.refresh(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.candidates).toEqual(candidateData.candidates);
    await act(async () => { next.resolve({ data: { ...candidateData, candidates: [] } }); await refresh; });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.candidates).toEqual([]);
  });

  it("exposes a persistent safe initial failure and supports a read-only retry", async () => {
    paychecksApi.getCandidates.mockRejectedValueOnce(serverError(500, "private"));
    const { result } = await ready();
    expect(result.current.loadError).toContain("couldn’t load your paychecks");
    expect(result.current.loadError).not.toContain("PRIVATE");
    let refreshed;
    await act(async () => { refreshed = await result.current.refresh(); });
    expect(refreshed).toBe(true);
    expect(result.current.loadError).toBeNull();
    expect(paychecksApi.createPaycheck).not.toHaveBeenCalled();
  });

  it("retains both previous resources when either refresh fails", async () => {
    const { result } = await ready();
    paychecksApi.getCandidates.mockResolvedValueOnce({ data: { ...candidateData, candidates: [] } });
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("network"));
    await act(() => result.current.refresh());
    expect(result.current.candidates).toEqual(candidateData.candidates);
    expect(result.current.paychecks).toEqual(profileData.paychecks);
    expect(result.current.loadError).toContain("out of date");
  });

  it("loads deposits with the same read and refreshes them after a write", async () => {
    const { result } = await ready();
    expect(result.current.inflows).toEqual([{ id: 1 }]);
    expect(result.current.suggestionsUnavailable).toBe(false);
    const firstRead = result.current.suggestionsReadId;
    inflowsApi.getAll.mockResolvedValueOnce({ data: [{ id: 2 }] });
    await act(() => result.current.recordReceipt("profile", { slotAnchor: "2026-08-10", existingInflowId: 1 }));
    expect(inflowsApi.getAll).toHaveBeenCalledTimes(2);
    expect(result.current.inflows).toEqual([{ id: 2 }]);
    expect(result.current.suggestionsReadId).toBeGreaterThan(firstRead);
  });

  it("keeps the page working when only the deposits read fails", async () => {
    inflowsApi.getAll.mockRejectedValueOnce(serverError(500, "private"));
    const { result } = await ready();
    expect(result.current.loadError).toBeNull();
    expect(result.current.paychecks).toEqual(profileData.paychecks);
    expect(result.current.candidates).toEqual(candidateData.candidates);
    expect(result.current.suggestionsUnavailable).toBe(true);
    expect(result.current.inflows).toEqual([]);
    expect(result.current.suggestionsReadId).toBe(0);
  });

  it("drops older deposits when a refresh cannot read them, and recovers on the next read", async () => {
    const { result } = await ready();
    inflowsApi.getAll.mockRejectedValueOnce(new Error("network"));
    await act(() => result.current.refresh());
    expect(result.current.inflows).toEqual([]);
    expect(result.current.suggestionsUnavailable).toBe(true);
    await act(() => result.current.refresh());
    expect(result.current.inflows).toEqual([{ id: 1 }]);
    expect(result.current.suggestionsUnavailable).toBe(false);
  });

  it("treats a malformed deposits payload as unavailable", async () => {
    inflowsApi.getAll.mockResolvedValueOnce({ data: { not: "a list" } });
    const { result } = await ready();
    expect(result.current.suggestionsUnavailable).toBe(true);
  });

  it("ignores a stale deposits read that finishes after a newer refresh", async () => {
    const { result } = await ready();
    const old = deferred();
    inflowsApi.getAll.mockReturnValueOnce(old.promise);
    let first;
    act(() => { first = result.current.refresh(); });
    inflowsApi.getAll.mockResolvedValueOnce({ data: [{ id: 9 }] });
    await act(() => result.current.refresh());
    await act(async () => { old.resolve({ data: [{ id: 5 }] }); await first; });
    expect(result.current.inflows).toEqual([{ id: 9 }]);
  });

  it("ignores older successful and failed reads when a newer refresh wins", async () => {
    const { result } = await ready();
    const old = deferred();
    paychecksApi.getCandidates.mockReturnValueOnce(old.promise);
    let first;
    act(() => { first = result.current.refresh(); });
    paychecksApi.getCandidates.mockResolvedValueOnce({ data: { ...candidateData, candidates: [{ fingerprint: "new" }] } });
    await act(() => result.current.refresh());
    await act(async () => { old.resolve({ data: { ...candidateData, candidates: [] } }); expect(await first).toBe(false); });
    expect(result.current.candidates).toEqual([{ fingerprint: "new" }]);
    const failed = deferred();
    paychecksApi.getCandidates.mockReturnValueOnce(failed.promise);
    act(() => { first = result.current.refresh(); });
    await act(() => result.current.refresh());
    await act(async () => { failed.reject(serverError(401)); await first; });
    expect(result.current.loadError).toBeNull();
  });

  it.each([
    ["confirmCandidate", [payload]], ["dismissCandidate", [tuple]], ["reconsiderCandidate", [tuple]],
    ["createPaycheck", [payload]], ["updatePaycheck", ["profile", payload]], ["updateLifecycle", ["profile", "ended"]],
  ])("%s returns a structured success and refreshes both resources", async (method, args) => {
    const { result } = await ready();
    let outcome;
    await act(async () => { outcome = await result.current[method](...args); });
    expect(paychecksApi[method]).toHaveBeenCalledWith(...args);
    expect(outcome).toEqual({ ok: true, data: { id: "saved" }, refreshOk: true });
    expect(paychecksApi.getCandidates).toHaveBeenCalledTimes(2);
    expect(paychecksApi.getPaychecks).toHaveBeenCalledTimes(2);
    expect(result.current.busyKey).toBeNull();
    expect(result.current.notice).toBeTruthy();
  });

  it("accepts an idempotent confirmation200 as success", async () => {
    const data = { paycheck: { id: "existing" }, alreadyConfirmed: true };
    paychecksApi.confirmCandidate.mockResolvedValueOnce({ status: 200, data });
    const { result } = await ready();
    let outcome;
    await act(async () => { outcome = await result.current.confirmCandidate(payload); });
    expect(outcome).toEqual({ ok: true, data, refreshOk: true });
    expect(result.current.notice).toBe("Pay schedule saved.");
  });

  it("guards duplicate and conflicting actions immediately, including during their refresh", async () => {
    const write = deferred();
    const refreshRead = deferred();
    paychecksApi.createPaycheck.mockReturnValueOnce(write.promise);
    const { result } = await ready();
    paychecksApi.getCandidates.mockReturnValueOnce(refreshRead.promise);
    let first, second;
    act(() => {
      first = result.current.createPaycheck(payload);
      second = result.current.updateLifecycle("profile", "ended");
    });
    expect(await second).toEqual({ ok: false, code: "busy" });
    expect(result.current.busyKey).toBe("create");
    await act(async () => { write.resolve({ data: { id: "saved" } }); await Promise.resolve(); });
    expect(result.current.busyKey).toBe("create");
    expect(await result.current.refresh()).toBe(false);
    expect(await result.current.createPaycheck(payload)).toEqual({ ok: false, code: "busy" });
    await act(async () => { refreshRead.resolve({ data: candidateData }); await first; });
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
    expect(paychecksApi.updateLifecycle).not.toHaveBeenCalled();
  });

  it("invalidates a pre-mutation read so it cannot replace state refreshed after the write", async () => {
    const { result } = await ready();
    const stale = deferred();
    paychecksApi.getCandidates.mockReturnValueOnce(stale.promise);
    let oldRead;
    act(() => { oldRead = result.current.refresh(); });
    paychecksApi.getCandidates.mockResolvedValueOnce({ data: { ...candidateData, candidates: [] } });
    await act(() => result.current.dismissCandidate(tuple));
    await act(async () => { stale.resolve({ data: candidateData }); await oldRead; });
    expect(result.current.candidates).toEqual([]);
  });

  it("keeps known creation success when refresh fails, without retrying or reporting a failed write", async () => {
    const { result } = await ready();
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("network"));
    let outcome;
    await act(async () => { outcome = await result.current.createPaycheck(payload); });
    expect(outcome).toEqual({ ok: true, data: { id: "saved" }, refreshOk: false });
    expect(result.current.notice).toBe("Pay schedule created.");
    expect(result.current.actionError).toBeNull();
    expect(result.current.loadError).toContain("couldn’t load your paychecks");
    expect(result.current.uncertainCreate).toBe(false);
    act(() => result.current.clearMessages());
    expect(result.current.loadError).toBeTruthy();
    await act(() => result.current.refresh());
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
  });

  it.each(["candidate_changed", "candidate_dismissed", "confirmation_conflict"])("refreshes %s conflicts without claiming an unsuccessful refresh succeeded", async (code) => {
    const { result } = await ready();
    paychecksApi.confirmCandidate.mockRejectedValueOnce(serverError(409, code));
    paychecksApi.getCandidates.mockRejectedValueOnce(new Error("network"));
    let outcome;
    await act(async () => { outcome = await result.current.confirmCandidate(payload); });
    expect(outcome).toEqual({ ok: false, code, refreshOk: false });
    expect(result.current.actionError).toBe(getPaycheckErrorMessage(serverError(409, code)));
    expect(result.current.actionError).not.toMatch(/has been loaded|refreshed|PRIVATE/);
    expect(result.current.loadError).toBeTruthy();
    expect(result.current.notice).toBeNull();
    expect(paychecksApi.confirmCandidate).toHaveBeenCalledTimes(1);
  });

  it("maps empty404 to unavailable and401 to expired session without leaking server text", async () => {
    const { result } = await ready();
    paychecksApi.updatePaycheck.mockRejectedValueOnce({ response: { status: 404, data: "" } });
    let outcome;
    await act(async () => { outcome = await result.current.updatePaycheck("missing", payload); });
    expect(outcome.code).toBe("paycheck_not_found");
    expect(result.current.actionError).toContain("no longer available");
    paychecksApi.updateLifecycle.mockRejectedValueOnce(serverError(401, "private"));
    await act(() => result.current.updateLifecycle("profile", "active"));
    expect(result.current.actionError).toContain("Sign in again");
    paychecksApi.getCandidates.mockRejectedValueOnce(serverError(401));
    await act(() => result.current.refresh());
    expect(result.current.loadError).toContain("Sign in again");
  });

  it("keeps correctable validation failures separate from uncertain writes", async () => {
    const { result } = await ready();
    paychecksApi.createPaycheck.mockRejectedValueOnce(serverError(400, "amount_invalid"));
    let outcome;
    await act(async () => { outcome = await result.current.createPaycheck(payload); });
    expect(outcome).toEqual({ ok: false, code: "amount_invalid" });
    expect(result.current.uncertainCreate).toBe(false);
    expect(result.current.actionError).toContain("fixed amount above zero");
    expect(paychecksApi.getPaychecks).toHaveBeenCalledTimes(1);
    expect(getPaycheckErrorMessage(serverError(400, "__proto__"))).toBe("We couldn’t complete that request. Try again.");
  });

  it.each([new Error("network timeout"), serverError(502, "private")])("blocks immediate manual retry after an uncertain response until a successful refresh", async (error) => {
    const { result } = await ready();
    paychecksApi.createPaycheck.mockRejectedValueOnce(error);
    let outcome;
    await act(async () => { outcome = await result.current.createPaycheck(payload); });
    expect(outcome).toEqual({ ok: false, code: "creation_uncertain", uncertain: true });
    expect(result.current.uncertainCreate).toBe(true);
    expect(result.current.actionError).toContain("check your pay schedules");
    act(() => result.current.clearMessages());
    expect(result.current.actionError).toContain("couldn’t confirm");
    expect(await result.current.createPaycheck(payload)).toEqual(outcome);
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("still offline"));
    await act(() => result.current.refresh());
    expect(result.current.uncertainCreate).toBe(true);
    await act(() => result.current.refresh());
    expect(result.current.uncertainCreate).toBe(false);
    expect(result.current.notice).toContain("Check your pay schedules");
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
  });

  it("permits only an explicit retry after uncertainty acknowledgement", async () => {
    const { result } = await ready();
    paychecksApi.createPaycheck.mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.createPaycheck(payload));
    act(() => result.current.acknowledgeUncertainCreate());
    expect(result.current.uncertainCreate).toBe(false);
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(1);
    await act(() => result.current.createPaycheck(payload));
    expect(paychecksApi.createPaycheck).toHaveBeenCalledTimes(2);
  });

  it("explains unknown outcomes of other writes without automatically retrying", async () => {
    const { result } = await ready();
    paychecksApi.updateLifecycle.mockRejectedValueOnce(new Error("offline"));
    let outcome;
    await act(async () => { outcome = await result.current.updateLifecycle("profile", "ended"); });
    expect(outcome).toEqual({ ok: false, code: "write_uncertain", uncertain: true });
    expect(result.current.actionError).toContain("Refresh and check");
    expect(result.current.uncertainCreate).toBe(false);
    expect(paychecksApi.updateLifecycle).toHaveBeenCalledTimes(1);
  });

  it("blocks an uncertain receipt retry until a successful refresh checks linked deposits", async () => {
    const { result } = await ready();
    const receipt = { slotAnchor: "2026-09-10", newInflow: { description: "Payroll", amount: "1000", date: "2026-09-10" } };
    paychecksApi.recordReceipt.mockRejectedValueOnce(new Error("offline"));
    let outcome;
    await act(async () => { outcome = await result.current.recordReceipt("profile", receipt); });
    expect(outcome).toEqual({ ok: false, code: "receipt_uncertain", uncertain: true });
    expect(result.current.uncertainReceipt).toBe(true);
    expect(await result.current.recordReceipt("profile", receipt)).toEqual(outcome);
    expect(paychecksApi.recordReceipt).toHaveBeenCalledTimes(1);
    paychecksApi.getPaychecks.mockRejectedValueOnce(new Error("still offline"));
    await act(() => result.current.refresh());
    expect(result.current.uncertainReceipt).toBe(true);
    await act(() => result.current.refresh());
    expect(result.current.uncertainReceipt).toBe(false);
    expect(result.current.notice).toContain("Check the linked deposits");
  });

  it("ignores read completions after unmount and prevents later imperative actions", async () => {
    const read = deferred();
    paychecksApi.getCandidates.mockReturnValueOnce(read.promise);
    const { result, unmount } = renderHook(() => usePaychecks());
    const actions = result.current;
    unmount();
    await act(async () => { read.resolve({ data: candidateData }); await Promise.resolve(); });
    expect(await actions.refresh()).toBe(false);
    expect(await actions.createPaycheck(payload)).toEqual({ ok: false, code: "unmounted" });
    expect(paychecksApi.createPaycheck).not.toHaveBeenCalled();
  });

  it.each([true, false])("does not start a refresh after a write completes on an unmounted hook (success=%s)", async (success) => {
    const write = deferred();
    const { result, unmount } = await ready();
    paychecksApi.createPaycheck.mockReturnValueOnce(write.promise);
    let pending;
    act(() => { pending = result.current.createPaycheck(payload); });
    unmount();
    await act(async () => {
      if (success) write.resolve({ data: { id: "saved" } });
      else write.reject(new Error("offline"));
      await pending;
    });
    expect(paychecksApi.getCandidates).toHaveBeenCalledTimes(1);
    expect(paychecksApi.getPaychecks).toHaveBeenCalledTimes(1);
  });
});
