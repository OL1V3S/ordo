import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { clearCaptureRecovery, getCaptureRecoverySnapshot, getCaptureRecoveryVolatileSnapshot, markCaptureRecovery, useCaptureRecovery } from "./captureRecovery";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); establishSession("token-a", "a@example.test"); });
afterEach(() => { clearSession(); sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });

describe("Home capture recovery marker", () => {
  it("stores only the allowed source kind under an account-scoped session key", () => {
    expect(markCaptureRecovery("account_inflow")).toBe(true);
    expect(sessionStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBe("account_inflow");
    expect(sessionStorage.length).toBe(1);
    expect(getCaptureRecoverySnapshot()).toBe("account_inflow");
  });

  it("rejects other stored values and clears the prior account marker on logout or account switch", () => {
    expect(markCaptureRecovery("expense")).toBe(true);
    establishSession("token-b", "b@example.test");
    expect(sessionStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBeNull();
    expect(getCaptureRecoverySnapshot()).toBeNull();
    sessionStorage.setItem("ordo-home-uncertain-write:b%40example.test", JSON.stringify({ amount: "9.00" }));
    expect(getCaptureRecoverySnapshot()).toBeNull();
    markCaptureRecovery("expense");
    clearSession();
    expect(sessionStorage.length).toBe(0);
  });

  it("requires an active scoped session", () => {
    clearSession();
    expect(markCaptureRecovery("expense")).toBe(false);
    expect(getCaptureRecoverySnapshot()).toBeNull();
  });

  it("falls back to account-scoped local storage when session storage rejects the marker", () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function set(key, value) {
      if (this === sessionStorage) throw new DOMException("blocked", "SecurityError");
      return setItem.call(this, key, value);
    });

    expect(markCaptureRecovery("expense")).toBe(true);
    expect(sessionStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBeNull();
    expect(localStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBe("expense");
    expect(getCaptureRecoverySnapshot()).toBe("expense");
    expect(clearCaptureRecovery()).toBe(true);
    expect(localStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBeNull();
  });

  it("keeps the current session fail-closed in memory when both browser stores reject writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(markCaptureRecovery("account_inflow")).toBe(false);
    expect(getCaptureRecoverySnapshot()).toBe("account_inflow");
    expect(getCaptureRecoveryVolatileSnapshot()).toBe(true);
    expect(sessionStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBeNull();
    expect(localStorage.getItem("ordo-home-uncertain-write:a%40example.test")).toBeNull();
    expect(clearCaptureRecovery()).toBe(true);
    expect(getCaptureRecoverySnapshot()).toBeNull();
  });

  it("does not let a stale session callback mark or clear the next account's recovery state", () => {
    const { result } = renderHook(() => useCaptureRecovery());
    const stale = result.current;
    act(() => establishSession("token-b", "b@example.test"));
    act(() => { markCaptureRecovery("account_inflow"); });

    expect(stale.mark("expense")).toBe(false);
    expect(stale.clear()).toBe(false);
    expect(getCaptureRecoverySnapshot()).toBe("account_inflow");
    expect(localStorage.getItem("ordo-home-uncertain-write:b%40example.test")).toBeNull();
  });
});
