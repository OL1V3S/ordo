import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { getCaptureRecoverySnapshot, markCaptureRecovery } from "./captureRecovery";

beforeEach(() => { sessionStorage.clear(); establishSession("token-a", "a@example.test"); });
afterEach(() => { clearSession(); sessionStorage.clear(); });

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
});
