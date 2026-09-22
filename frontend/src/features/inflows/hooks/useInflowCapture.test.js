import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { useInflowCapture } from "./useInflowCapture";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function setup(overrides = {}) {
  const dependencies = {
    refresh: vi.fn().mockResolvedValue({ stale: false }),
    createInflow: vi.fn().mockResolvedValue({ refreshFailed: false }),
    updateInflow: vi.fn().mockResolvedValue({ refreshFailed: false }),
    deleteInflow: vi.fn().mockResolvedValue({ refreshFailed: false }),
    isExternallyBlocked: vi.fn(() => false),
    ...overrides,
  };
  return { dependencies, ...renderHook(() => useInflowCapture(dependencies)) };
}

function fill(result) {
  act(() => {
    result.current.openTask("create", null, null);
    result.current.updateDraft({
      description: "  Refund  From Store  ",
      amount: "9999999999999999.99",
      date: "2026-09-21",
    });
  });
}

describe("cash-in capture controller", () => {
  beforeEach(() => establishSession("owner-a", "a@example.test"));
  afterEach(() => clearSession());

  it("does not read on mount and submits an exact create payload", async () => {
    const { dependencies, result } = setup();
    expect(dependencies.refresh).not.toHaveBeenCalled();
    fill(result);
    await act(() => result.current.submitTask());
    expect(dependencies.createInflow).toHaveBeenCalledExactlyOnceWith({
      description: "Refund  From Store",
      amount: "9999999999999999.99",
      date: "2026-09-21",
    });
    expect(result.current.task).toBeNull();
    expect(result.current.feedback).toMatchObject({ outcome: "completed", kind: "create", saved: true });
  });

  it("prevents double submit while a write is pending", async () => {
    const write = deferred();
    const { dependencies, result } = setup({ createInflow: vi.fn(() => write.promise) });
    fill(result);
    let first;
    act(() => { first = result.current.submitTask(); });
    act(() => { result.current.submitTask(); });
    expect(dependencies.createInflow).toHaveBeenCalledOnce();
    await act(() => write.resolve({ refreshFailed: false }));
    await first;
  });

  it("requires an authoritative read and acknowledgement after an unknown write", async () => {
    const { dependencies, result } = setup({ createInflow: vi.fn().mockRejectedValue(new Error("offline")) });
    fill(result);
    await act(() => result.current.submitTask());
    expect(result.current).toMatchObject({ gate: "unknown", checkedRead: false });
    expect(result.current.task.draft.description).toBe("  Refund  From Store  ");

    dependencies.refresh.mockRejectedValueOnce(new Error("read failed"));
    await act(() => result.current.refreshRecovery());
    expect(result.current).toMatchObject({ gate: "unknown", checkedRead: false });
    await act(() => result.current.refreshRecovery());
    expect(result.current).toMatchObject({ gate: "unknown", checkedRead: true });
    act(() => result.current.acknowledgeUnknown());
    expect(result.current.gate).toBeNull();
    expect(result.current.task.draft.description).toBe("  Refund  From Store  ");
  });

  it("maps validation without exposing server text", async () => {
    const createInflow = vi.fn().mockRejectedValue({ response: { status: 400, data: { errors: { Amount: ["private"] } } } });
    const { result } = setup({ createInflow });
    fill(result);
    await act(() => result.current.submitTask());
    expect(result.current.fieldErrors).toEqual({ amount: "amount_invalid" });
    expect(JSON.stringify(result.current)).not.toContain("private");
  });

  it("retains known success and gates another mutation after refresh failure", async () => {
    const { result } = setup({ createInflow: vi.fn().mockResolvedValue({ refreshFailed: true }) });
    fill(result);
    await act(() => result.current.submitTask());
    expect(result.current).toMatchObject({ task: null, gate: "refresh" });
    expect(result.current.feedback).toMatchObject({ outcome: "completed", refreshFailed: true });
  });

  it("suppresses stale completion state after the session changes", async () => {
    const write = deferred();
    const { result } = setup({ createInflow: vi.fn(() => write.promise) });
    fill(result);
    let outcome;
    act(() => { outcome = result.current.submitTask(); });
    act(() => establishSession("owner-b", "b@example.test"));
    await act(() => write.resolve({ refreshFailed: false }));
    await outcome;
    expect(result.current.task.draft.description).toBe("  Refund  From Store  ");
    expect(result.current.feedback).toBeNull();
  });
});
