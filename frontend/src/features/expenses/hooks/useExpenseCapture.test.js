import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { useExpenseCapture } from "./useExpenseCapture";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const dependencies = {
    createExpense: vi.fn().mockResolvedValue({ refreshFailed: false }),
    refresh: vi.fn().mockResolvedValue({ stale: false }),
    readUnavailable: false,
    isExternallyBlocked: vi.fn(() => false),
    ...overrides,
  };
  return { dependencies, ...renderHook(() => useExpenseCapture(dependencies)) };
}

async function fill(result) {
  act(() => {
    result.current.openCreate(null);
    result.current.updateDraft("description", "  Dinner With Friends  ");
    result.current.updateDraft("amount", "12.50");
    result.current.updateDraft("date", "2026-09-21");
    result.current.updateDraft("category", "food");
  });
}

describe("expense capture controller", () => {
  beforeEach(() => establishSession("owner-a", "a@example.test"));
  afterEach(() => clearSession());

  it("does not read on mount and submits an exact canonical amount", async () => {
    const { dependencies, result } = setup();
    expect(dependencies.refresh).not.toHaveBeenCalled();
    await fill(result);

    await act(() => result.current.submitCreate());

    expect(dependencies.createExpense).toHaveBeenCalledExactlyOnceWith({
      description: "dinner with friends",
      amount: "12.50",
      date: "2026-09-21",
      category: "food",
    });
    expect(result.current.open).toBe(false);
    expect(result.current.draft.description).toBe("");
    expect(result.current.feedback).toMatchObject({ outcome: "completed", kind: "create", refreshFailed: false });
  });

  it("admits one write and retains an unknown draft until a successful explicit read", async () => {
    const pending = deferred();
    const { dependencies, result } = setup({ createExpense: vi.fn(() => pending.promise) });
    await fill(result);
    let first;
    act(() => { first = result.current.submitCreate(); });
    act(() => { result.current.submitCreate(); });
    expect(dependencies.createExpense).toHaveBeenCalledOnce();
    await act(() => pending.reject(new Error("offline")));
    await expect(first).resolves.toBeUndefined();
    expect(result.current).toMatchObject({ open: true, recoveryRequired: true });
    expect(result.current.draft.description).toBe("  Dinner With Friends  ");

    dependencies.refresh.mockRejectedValueOnce(new Error("still offline"));
    await act(() => result.current.refreshRecovery());
    expect(result.current.recoveryRequired).toBe(true);
    await act(() => result.current.refreshRecovery());
    expect(result.current.recoveryRequired).toBe(false);
    expect(result.current.feedback.outcome).toBe("refreshed");
  });

  it("keeps known success when refresh failed and does not expose the completed draft", async () => {
    const { result } = setup({ createExpense: vi.fn().mockResolvedValue({ refreshFailed: true }) });
    await fill(result);
    await act(() => result.current.submitCreate());
    expect(result.current).toMatchObject({ open: false, recoveryRequired: true });
    expect(result.current.feedback).toMatchObject({ outcome: "completed", refreshFailed: true });
  });

  it("suppresses stale completion state after the session changes", async () => {
    const write = deferred();
    const { result } = setup({ createExpense: vi.fn(() => write.promise) });
    await fill(result);
    let outcome;
    act(() => { outcome = result.current.submitCreate(); });
    act(() => establishSession("owner-b", "b@example.test"));
    await act(() => write.resolve({ refreshFailed: false }));
    await outcome;
    expect(result.current.open).toBe(true);
    expect(result.current.draft.description).toBe("  Dinner With Friends  ");
    expect(result.current.feedback).toBeNull();
  });

  describe("missing records", () => {
    const notFound = () => Object.assign(new Error("not found"), { response: { status: 404 } });

    it.each(["update", "delete"])("treats a %s 404 as missing, blocks writes, and skips onUnknown", async (kind) => {
      const onUnknown = vi.fn();
      const onMissing = vi.fn();
      const { result } = setup({ onUnknown });
      await act(async () => { await result.current.runMutation(() => Promise.reject(notFound()), kind, undefined, { onMissing }); });
      expect(result.current.feedback).toEqual({ tone: "danger", outcome: "missing" });
      expect(result.current.recoveryRequired).toBe(true);
      expect(onMissing).toHaveBeenCalledOnce();
      expect(onUnknown).not.toHaveBeenCalled();
    });

    it("keeps a create 404 on the unknown path", async () => {
      const onUnknown = vi.fn();
      const { result } = setup({ onUnknown, createExpense: vi.fn().mockRejectedValue(notFound()) });
      await fill(result);
      await act(async () => { await result.current.submitCreate(); });
      expect(result.current.feedback).toEqual({ tone: "danger", outcome: "unknown" });
      expect(result.current.recoveryRequired).toBe(true);
      expect(onUnknown).toHaveBeenCalledOnce();
    });

    it.each([500, undefined])("keeps status %s on the unknown path for updates", async (status) => {
      const onUnknown = vi.fn();
      const { result } = setup({ onUnknown });
      const error = status ? Object.assign(new Error("x"), { response: { status } }) : new Error("network");
      await act(async () => { await result.current.runMutation(() => Promise.reject(error), "update"); });
      expect(result.current.feedback.outcome).toBe("unknown");
      expect(onUnknown).toHaveBeenCalledOnce();
    });
  });
});
