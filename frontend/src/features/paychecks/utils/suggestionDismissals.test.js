import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession, getSessionSnapshot } from "../../../shared/auth/session";
import {
  dismissSuggestion, MAX_DISMISSALS, pruneDismissals, readDismissals, resetDismissalsForTests, restoreSuggestion,
} from "./suggestionDismissals";

const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (id) => `${b64({ alg: "HS256" })}.${b64({ "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": id })}.sig`;
const sessionFor = (id, email = "person@example.com") => {
  establishSession(tokenFor(id), email);
  return getSessionSnapshot();
};
const keyFor = (n) => `profile-${n}|2026-08-10|${n}`;
const storageKeys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key) => key.startsWith("ordo-paycheck-suggestion-dismissals:"));

describe("suggestionDismissals", () => {
  beforeEach(() => { localStorage.clear(); clearSession(); resetDismissalsForTests(); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); clearSession(); });

  it("dismisses and restores a match", () => {
    const session = sessionFor("user-a");
    dismissSuggestion(session, keyFor(1));
    expect(readDismissals(session).has(keyFor(1))).toBe(true);
    restoreSuggestion(session, keyFor(1));
    expect(readDismissals(session).size).toBe(0);
    expect(storageKeys()).toEqual([]);
  });

  it("isolates dismissals per account", () => {
    const a = sessionFor("user-a");
    dismissSuggestion(a, keyFor(1));
    const b = sessionFor("user-b");
    expect(readDismissals(b).size).toBe(0);
    const again = sessionFor("user-a");
    expect(readDismissals(again).has(keyFor(1))).toBe(true);
  });

  it("stores only IDs and a date under a key that excludes the email and survives logout", () => {
    const session = sessionFor("user-a", "private.person@example.com");
    dismissSuggestion(session, keyFor(1));
    clearSession();
    const [key] = storageKeys();
    expect(key).toBeDefined();
    expect(key).not.toContain("example.com");
    expect(key).not.toContain("private");
    expect(localStorage.getItem(key)).toBe(JSON.stringify([keyFor(1)]));
  });

  it("falls back to memory when storage is disabled, without throwing", () => {
    const session = sessionFor("user-mem");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (String(key).startsWith("ordo-paycheck")) throw new Error("denied");
      return null;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => dismissSuggestion(session, keyFor(2))).not.toThrow();
    expect(readDismissals(session).has(keyFor(2))).toBe(true);
  });

  it("keeps dismissals in memory only when the token has no account identifier", () => {
    establishSession("opaque-token-without-claims", "x@example.com");
    const session = getSessionSnapshot();
    dismissSuggestion(session, keyFor(3));
    expect(readDismissals(session).has(keyFor(3))).toBe(true);
    expect(storageKeys()).toEqual([]);
  });

  it("ignores malformed stored values and non-array payloads", () => {
    const session = sessionFor("user-bad");
    const key = `ordo-paycheck-suggestion-dismissals:${encodeURIComponent("user-bad")}`;
    localStorage.setItem(key, JSON.stringify([keyFor(1), 5, null, "garbage", "a|b|c", "x|2026-08-10|not-a-number"]));
    expect([...readDismissals(session)]).toEqual([keyFor(1)]);
    localStorage.setItem(key, "{not json");
    expect(readDismissals(session).size).toBe(0);
    localStorage.setItem(key, JSON.stringify({ a: 1 }));
    expect(readDismissals(session).size).toBe(0);
  });

  it("returns a stable snapshot until the stored values change", () => {
    const session = sessionFor("user-stable");
    dismissSuggestion(session, keyFor(1));
    expect(readDismissals(session)).toBe(readDismissals(session));
  });

  it("prunes only entries the predicate reports as no longer current", () => {
    const session = sessionFor("user-prune");
    dismissSuggestion(session, keyFor(1));
    dismissSuggestion(session, keyFor(2));
    pruneDismissals(session, (value) => value === keyFor(2));
    expect([...readDismissals(session)]).toEqual([keyFor(2)]);
  });

  it("caps stored dismissals, dropping the oldest", () => {
    const session = sessionFor("user-cap");
    for (let n = 1; n <= MAX_DISMISSALS + 5; n += 1) dismissSuggestion(session, keyFor(n));
    const stored = readDismissals(session);
    expect(stored.size).toBe(MAX_DISMISSALS);
    expect(stored.has(keyFor(1))).toBe(false);
    expect(stored.has(keyFor(MAX_DISMISSALS + 5))).toBe(true);
  });

  it("rejects values that do not look like a schedule, slot and deposit key", () => {
    const session = sessionFor("user-invalid");
    dismissSuggestion(session, "Acme Payroll 2500");
    expect(readDismissals(session).size).toBe(0);
  });
});
