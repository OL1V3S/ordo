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

  it("does not read on mount and submits the unchanged legacy payload", async () => {
    const { dependencies, result } = setup();
    expect(dependencies.refresh).not.toHaveBeenCalled();
    await fill(result);

    await act(() => result.current.submitCreate());

    expect(dependencies.createExpense).toHaveBeenCalledExactlyOnceWith({
      description: "dinner with friends",
      amount: 12.5,
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
});
